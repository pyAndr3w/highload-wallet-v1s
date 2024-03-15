import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, SendMode, toNano } from '@ton/core';
import { HighloadWalletV1S } from '../wrappers/HighloadWalletV1S';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from '@ton/crypto';
import { randomBytes } from 'crypto';

const SUBWALLET_ID = 239;

describe('HighloadWalletV1S', () => {
    let code: Cell;
    let keyPair: KeyPair;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let highloadWalletV1S: SandboxContract<HighloadWalletV1S>;

    beforeAll(async () => {
        code = await compile('HighloadWalletV1S');
        keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
    });


    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 1000;

        highloadWalletV1S = blockchain.openContract(
            HighloadWalletV1S.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: SUBWALLET_ID
            }, code)
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await highloadWalletV1S.sendDeploy(deployer.getSender(), toNano('999999'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: highloadWalletV1S.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        expect(await highloadWalletV1S.getPublicKey()).toEqual(keyPair.publicKey);
        expect(await highloadWalletV1S.getSubwalletId()).toEqual(SUBWALLET_ID);
        expect(await highloadWalletV1S.getSeqno()).toEqual(0);
    });

    it('should pass check sign', async () => {
        try {
            const message = highloadWalletV1S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
            const testResult = await highloadWalletV1S.sendExternalMessage(
                keyPair.secretKey,
                {
                    message,
                    mode: 128,
                    subwalletId: SUBWALLET_ID,
                    seqno: 0,
                    validUntil: 1100
                }
            );

            expect(testResult.transactions).toHaveTransaction({
                from: highloadWalletV1S.address,
                to: highloadWalletV1S.address,
                success: true,
            });
        } catch (e: any) {
            console.log(e.vmLogs)
        }
    });

    it('should fail check sign', async () => {
        const message = highloadWalletV1S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV1S.sendExternalMessage(
            keyPair.secretKey,
            {
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID,
                seqno: 0,
                validUntil: 999
            }
        )).rejects.toThrow();
    });

    it('should fail check subwallet_id', async () => {
        const message = highloadWalletV1S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV1S.sendExternalMessage(
            keyPair.secretKey,
            {
                message,
                mode: 128,
                subwalletId: 17,
                seqno: 0,
                validUntil: 1100
            }
        )).rejects.toThrow();
    });


    it('should fail check seqno', async () => {
        const message = highloadWalletV1S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV1S.sendExternalMessage(
            keyPair.secretKey,
            {
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID,
                seqno: 17,
                validUntil: 1100
            }
        )).rejects.toThrow();
    });

    it('should fail check valid_until', async () => {
        const message = highloadWalletV1S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV1S.sendExternalMessage(
            randomBytes(64),
            {
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID,
                seqno: 0,
                validUntil: 1100
            }
        )).rejects.toThrow();
    });

    it('should send ordinary transaction', async () => {
        const message = highloadWalletV1S.createInternalTransfer({actions: [{
                    type: 'sendMsg',
                    mode: SendMode.NONE,
                    outMsg: {
                        info: {
                            type: 'external-out',
                            createdAt: 0,
                            createdLt: 0n
                        },
                        body: beginCell().endCell()
                    }
                }], queryId: 0, value: 0n})
        const testResult = await highloadWalletV1S.sendExternalMessage(
            keyPair.secretKey,
            {
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID,
                seqno: 0,
                validUntil: 1100
            }
        );

        expect(testResult.transactions).toHaveTransaction({
            from: highloadWalletV1S.address,
            to: highloadWalletV1S.address,
            success: true,
            outMessagesCount: 1,
            actionResultCode: 0
        });
    });

    it('should work replay protection, but dont send message', async () => {
        const testResult = await highloadWalletV1S.sendExternalMessage(
            keyPair.secretKey,
            {
                message: beginCell().storeUint(239, 17).endCell(),
                mode: 128,
                subwalletId: SUBWALLET_ID,
                seqno: 0,
                validUntil: 1100
            }
        );

        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV1S.address,
            success: true,
            outMessagesCount: 0,
            actionResultCode: 0
        });
    });
});
