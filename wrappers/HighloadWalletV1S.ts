import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, Message, OutAction,
    Sender,
    SendMode, storeMessage,
    storeOutList
} from '@ton/core';
import { sign } from '@ton/crypto';

export type HighloadWalletV1SConfig = {
    publicKey: Buffer,
    subwalletId: number,
};

export function highloadWalletV1SConfigToCell(config: HighloadWalletV1SConfig): Cell {
    return beginCell().storeBuffer(config.publicKey).storeUint(config.subwalletId, 32).storeUint(0, 32).endCell();
}

export enum OP {
    InternalTransfer = 0xae42e5a4
}

export class HighloadWalletV1S implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new HighloadWalletV1S(address);
    }

    static createFromConfig(config: HighloadWalletV1SConfig, code: Cell, workchain = 0) {
        const data = highloadWalletV1SConfigToCell(config);
        const init = { code, data };
        return new HighloadWalletV1S(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendExternalMessage(
        provider: ContractProvider,
        secretKey: Buffer,
        opts: {
            message: Message | Cell,
            mode: number
            subwalletId: number,
            seqno: number,
            validUntil: number
        }
    ){
        let messageCell: Cell;
        if (opts.message instanceof Cell) {
            messageCell = opts.message
        } else {
            const messageBuilder = beginCell();
            messageBuilder.store(storeMessage(opts.message))
            messageCell = messageBuilder.endCell();
        }

        // _ {n:#} message:^Cell mode:uint8 subwallet_id:uint32 seq_no:uint32 valid_until:uint64 = MsgInner;
        const messageInner = beginCell()
                            .storeRef(messageCell)
                            .storeUint(opts.mode, 8)
                            .storeUint(opts.subwalletId, 32)
                            .storeUint(opts.seqno, 32)
                            .storeUint(opts.validUntil, 64)
                            .endCell();

        // msg_body$_ {n:#} sign:bits512 ^(MsgInner) = ExternalInMsgBody;
        await provider.external(
            beginCell()
           .storeBuffer(sign(messageInner.hash(), secretKey))
           .storeRef(messageInner)
           .endCell()
        );
    }

    createInternalTransfer(opts: {
        actions:  OutAction[] | Cell
        queryId: number,
        value: bigint
    }) {
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions;
        } else {
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        // internal_transfer#ae42e5a4 {n:#} query_id:uint64 actions:^(OutList n) = InternalMsgBody n;
        const body = beginCell()
            .storeUint(OP.InternalTransfer, 32)
            .storeUint(opts.queryId, 64)
            .storeRef(actionsCell)
            .endCell();

        return beginCell()
            .storeUint(0x10, 6)
            .storeAddress(this.address)
            .storeCoins(opts.value)
            .storeUint(0, 107)
            .storeSlice(body.asSlice())
            .endCell();
    }


    async getSeqno(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('seqno', [])).stack;
        return res.readNumber();
    }
    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get('get_public_key', [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, '0'), 'hex');
    }

    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_subwallet_id', [])).stack;
        return res.readNumber();
    }

}
