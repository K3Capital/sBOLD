// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    mapping(address => uint256) quotes;
    string public name = "MockPriceOracle";
    address public quote = address(1);
    uint256 public quoteAmount;

    function setQuote(address base, uint256 _quoteAmount) external {
        quotes[base] = _quoteAmount;
    }

    function isBaseSupported(address base) external view returns (bool) {}

    function getQuote(uint256, address base) external view returns (uint256 outAmount) {
        return quotes[base];
    }
}
