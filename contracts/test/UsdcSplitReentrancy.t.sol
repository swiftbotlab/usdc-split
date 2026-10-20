// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UsdcSplit} from "../UsdcSplit.sol";
import {ReentrantReceiver} from "../test-helpers/SplitHelpers.sol";

/// @dev Reentrancy tests: from receive() (triggered by withdraw and by release)
///      re-enter every state-changing function on a SECOND armed split and assert
///      the inner revert data equals ReentrancyGuardReentrantCall().
contract UsdcSplitReentrancyTest is Test {
    UsdcSplit        internal split;
    ReentrantReceiver internal rr;

    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");
    address internal ctrl   = makeAddr("controller");

    uint64 constant DELAY = 120;

    // The expected revert selector from OZ 5.x ReentrancyGuard
    bytes internal constant REENTRANT_CALL_ERROR =
        abi.encodeWithSignature("ReentrancyGuardReentrantCall()");

    function setUp() public {
        split = new UsdcSplit();
        rr    = new ReentrantReceiver();

        vm.deal(address(rr), 10 ether);
        vm.deal(address(this), 10 ether);
        vm.deal(alice, 1 ether);
        vm.deal(ctrl, 1 ether);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// Creates split1 where `rr` holds 50% and `bob` holds 50%; pays 2 ether.
    /// Returns split1 id.
    function _armSplit1() internal returns (uint256 id1) {
        address[] memory accs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        accs[0] = address(rr); accs[1] = bob;
        bps[0]  = 5000;        bps[1]  = 5000;
        id1 = split.createSplit("split1", accs, bps, address(0), 0);
        split.pay{value: 2 ether}(id1, "");
    }

    /// Creates split2 (managed, fully armed):
    ///   - alice + carol as recipients, paid 2 ether
    ///   - ctrl as controller, changeDelay=DELAY
    ///   - a pending ready change (warp to eta so executeChange is callable)
    /// Returns split2 id.
    function _armSplit2() internal returns (uint256 id2) {
        address[] memory accs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        accs[0] = alice; accs[1] = carol;
        bps[0]  = 5000;  bps[1]  = 5000;
        id2 = split.createSplit("split2", accs, bps, ctrl, DELAY);
        split.pay{value: 2 ether}(id2, "");

        // Propose change and warp to eta (so executeChange is ready)
        address[] memory newAccs = new address[](2);
        uint16[]  memory newBps  = new uint16[](2);
        newAccs[0] = alice; newAccs[1] = bob;
        newBps[0]  = 5000;  newBps[1]  = 5000;
        vm.prank(ctrl); split.proposeChange(id2, newAccs, newBps);
        (, , uint64 eta) = split.getPendingChange(id2);
        vm.warp(eta);
    }

    /// Configure `rr` so that on receive() it re-enters `fn` on `split2`.
    function _armRr(ReentrantReceiver.Fn fn, uint256 split2Id) internal {
        rr.setTarget(address(split));
        rr.setFn(fn);
        rr.setArg(split2Id, 1 /*version*/);
        rr.setReentryRecipients(alice, bob);
        rr.setArmed(true);
    }

    /// Helper: trigger rr's receive via withdraw on split1,
    /// then check lastRevertData == REENTRANT_CALL_ERROR.
    function _testViaWithdraw(ReentrantReceiver.Fn fn, uint256 split1Id, uint256 split2Id) internal {
        _armRr(fn, split2Id);
        vm.prank(address(rr));
        split.withdraw(split1Id);
        assertEq(rr.lastRevertData(), REENTRANT_CALL_ERROR,
            string(abi.encodePacked("withdraw reentry failed for fn=", uint256(fn))));
    }

    /// Helper: trigger rr's receive via release on split1,
    /// then check lastRevertData == REENTRANT_CALL_ERROR.
    function _testViaRelease(ReentrantReceiver.Fn fn, uint256 split1Id, uint256 split2Id) internal {
        _armRr(fn, split2Id);
        split.release(split1Id, address(rr));
        assertEq(rr.lastRevertData(), REENTRANT_CALL_ERROR,
            string(abi.encodePacked("release reentry failed for fn=", uint256(fn))));
    }

    // -----------------------------------------------------------------------
    // Reentrancy via withdraw
    // -----------------------------------------------------------------------
    function test_reentry_withdraw_CreateSplit() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.CreateSplit, s1, s2);
    }

    function test_reentry_withdraw_Pay() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.Pay, s1, s2);
    }

    function test_reentry_withdraw_PayAtVersion() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.PayAtVersion, s1, s2);
    }

    function test_reentry_withdraw_Withdraw() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.Withdraw, s1, s2);
    }

    function test_reentry_withdraw_Release() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.Release, s1, s2);
    }

    function test_reentry_withdraw_Distribute() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.Distribute, s1, s2);
    }

    function test_reentry_withdraw_ProposeChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.ProposeChange, s1, s2);
    }

    function test_reentry_withdraw_CancelChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.CancelChange, s1, s2);
    }

    function test_reentry_withdraw_ExecuteChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.ExecuteChange, s1, s2);
    }

    function test_reentry_withdraw_LockSplit() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaWithdraw(ReentrantReceiver.Fn.LockSplit, s1, s2);
    }

    // -----------------------------------------------------------------------
    // Reentrancy via release
    // -----------------------------------------------------------------------
    function test_reentry_release_CreateSplit() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.CreateSplit, s1, s2);
    }

    function test_reentry_release_Pay() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.Pay, s1, s2);
    }

    function test_reentry_release_PayAtVersion() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.PayAtVersion, s1, s2);
    }

    function test_reentry_release_Withdraw() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.Withdraw, s1, s2);
    }

    function test_reentry_release_Release() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.Release, s1, s2);
    }

    function test_reentry_release_Distribute() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.Distribute, s1, s2);
    }

    function test_reentry_release_ProposeChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.ProposeChange, s1, s2);
    }

    function test_reentry_release_CancelChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.CancelChange, s1, s2);
    }

    function test_reentry_release_ExecuteChange() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.ExecuteChange, s1, s2);
    }

    function test_reentry_release_LockSplit() public {
        uint256 s1 = _armSplit1(); uint256 s2 = _armSplit2();
        _testViaRelease(ReentrantReceiver.Fn.LockSplit, s1, s2);
    }
}
