// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IHooks {
    function beforeInitialize(address,bytes32,address,address,uint24,int24,address) external returns (bytes4);
}

contract LiveCandidateForkProbe is Test {
    function testDirectCallbacksRejectNonManager() external {
        _expectDirectRevert(0x1d1190BD664A5B3D3964b63971DebC7D3e5a1fc0);
        _expectDirectRevert(0x2016C0e4F8Bb1d6feA777DC791bE919E2eDa40c0);
        _expectDirectRevert(0xb216070c3509047ea597E2E626A29cea427a60C8);
    }

    function _expectDirectRevert(address hook) private {
        bytes32 id = bytes32(uint256(1));
        (bool ok, bytes memory result) = hook.call(
            abi.encodeCall(IHooks.beforeInitialize,(address(this),id,address(1),address(2),500,10,address(3)))
        );
        assertFalse(ok, "direct callback unexpectedly succeeded");
        emit log_named_bytes("revert", result);
    }
}
