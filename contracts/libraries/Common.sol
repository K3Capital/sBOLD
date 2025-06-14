// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ICommon} from "../interfaces/ICommon.sol";

library Common {
    function revertZeroAddress(address _address) internal pure {
        if (_address == address(0)) revert ICommon.InvalidAddress();
    }
}
