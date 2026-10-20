// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {UsdcSplit} from "../UsdcSplit.sol";

/// @dev Tests for managed lifecycle: propose/execute/cancel/lock, payAtVersion, ChangeExpired.
contract UsdcSplitChangesTest is Test {
    UsdcSplit internal split;

    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");
    address internal dave   = makeAddr("dave");
    address internal payer  = makeAddr("payer");
    address internal ctrl   = makeAddr("controller");
    address internal anyone = makeAddr("anyone");

    uint64 constant DELAY      = 120;        // 2 minutes
    uint64 constant GRACE      = 7 days;

    function setUp() public {
        split = new UsdcSplit();
        vm.deal(payer, 100 ether);
        vm.deal(anyone, 1 ether);
        vm.deal(ctrl, 1 ether);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------
    function _createManaged(address a, address b) internal returns (uint256 id) {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = a; accs[1] = b; bps[0] = 5000; bps[1] = 5000;
        id = split.createSplit("mgd", accs, bps, ctrl, DELAY);
    }

    function _newTable(address a, address b) internal pure returns (address[] memory accs, uint16[] memory bps) {
        accs = new address[](2); bps = new uint16[](2);
        accs[0] = a; accs[1] = b; bps[0] = 6000; bps[1] = 4000;
    }

    // -----------------------------------------------------------------------
    // Full managed lifecycle
    // -----------------------------------------------------------------------
    function test_lifecycle_fullManaged() public {
        uint256 id = _createManaged(alice, bob);

        // Pay before change → credited to v1 table
        vm.prank(payer); split.pay{value: 2 ether}(id, "pre");
        assertEq(split.withdrawable(id, alice), 1 ether);
        assertEq(split.withdrawable(id, bob),   1 ether);

        // Propose change: alice→60%, bob→0%, carol→40%
        (address[] memory newAccs, uint16[] memory newBps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, newAccs, newBps);

        (, , uint64 eta) = split.getPendingChange(id);
        assertTrue(eta > 0);

        // executeChange reverts before eta
        vm.warp(eta - 1);
        vm.expectRevert(UsdcSplit.ChangeNotReady.selector);
        split.executeChange(id);

        // executeChange succeeds at eta – by anyone
        vm.warp(eta);
        vm.prank(anyone); split.executeChange(id);

        UsdcSplit.Split memory s = split.getSplit(id);
        assertEq(s.version, 2);

        // Old credits (alice/bob) still intact after change
        assertEq(split.withdrawable(id, alice), 1 ether);
        assertEq(split.withdrawable(id, bob),   1 ether);

        // New payment uses new table (carol/dave)
        vm.prank(payer); split.pay{value: 10 ether}(id, "post");
        // carol 60% = 6 ether (remainder because she is index 0)
        // dave  40% = 4 ether
        assertEq(split.withdrawable(id, carol), 6 ether);
        assertEq(split.withdrawable(id, dave),  4 ether);
        // alice/bob unchanged from before
        assertEq(split.withdrawable(id, alice), 1 ether);
        assertEq(split.withdrawable(id, bob),   1 ether);

        // Removed recipient alice withdraws old credit
        uint256 ab = alice.balance;
        vm.prank(alice); split.withdraw(id);
        assertEq(alice.balance - ab, 1 ether);
        assertEq(split.withdrawable(id, alice), 0);

        // payAtVersion with old version=1 reverts (current version is 2)
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.VersionChanged.selector);
        split.payAtVersion{value: 1 ether}(id, "", 1);
    }

    // -----------------------------------------------------------------------
    // release pays a removed recipient
    // -----------------------------------------------------------------------
    function test_release_removedRecipient() public {
        uint256 id = _createManaged(alice, bob);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");

        // Change to carol/dave
        (address[] memory newAccs, uint16[] memory newBps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, newAccs, newBps);
        (, , uint64 eta) = split.getPendingChange(id);
        vm.warp(eta);
        split.executeChange(id);

        // alice was removed – anyone can release her
        uint256 ab = alice.balance;
        vm.prank(anyone); split.release(id, alice);
        assertEq(alice.balance - ab, 1 ether);
    }

    // -----------------------------------------------------------------------
    // ChangeExpired
    // -----------------------------------------------------------------------
    function test_changeExpired() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);
        (, , uint64 eta) = split.getPendingChange(id);

        // Warp past grace
        vm.warp(uint256(eta) + GRACE + 1);
        vm.expectRevert(UsdcSplit.ChangeExpired.selector);
        split.executeChange(id);

        // Proposal is still pending (pendingEta != 0)
        (, , uint64 etaAfter) = split.getPendingChange(id);
        assertEq(etaAfter, eta); // unchanged
    }

    // -----------------------------------------------------------------------
    // cancelChange
    // -----------------------------------------------------------------------
    function test_cancelChange() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);

        vm.expectEmit(true, false, false, false);
        emit UsdcSplit.ChangeCancelled(id);
        vm.prank(ctrl); split.cancelChange(id);

        // NoPendingChange after cancel
        vm.prank(ctrl);
        vm.expectRevert(UsdcSplit.NoPendingChange.selector);
        split.cancelChange(id);

        (, , uint64 eta) = split.getPendingChange(id);
        assertEq(eta, 0);
    }

    function test_cancelChange_NoPendingChange_initial() public {
        uint256 id = _createManaged(alice, bob);
        vm.prank(ctrl);
        vm.expectRevert(UsdcSplit.NoPendingChange.selector);
        split.cancelChange(id);
    }

    // -----------------------------------------------------------------------
    // proposeChange replaces existing pending
    // -----------------------------------------------------------------------
    function test_proposeChange_replacesExisting() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs1, uint16[] memory bps1) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs1, bps1);
        (, , uint64 eta1) = split.getPendingChange(id);

        // Propose again – overwrites
        address[] memory accs2 = new address[](2); uint16[] memory bps2 = new uint16[](2);
        accs2[0] = alice; accs2[1] = bob; bps2[0] = 3000; bps2[1] = 7000;
        vm.warp(block.timestamp + 1);
        vm.prank(ctrl); split.proposeChange(id, accs2, bps2);
        (, , uint64 eta2) = split.getPendingChange(id);
        assertTrue(eta2 > eta1);
    }

    // -----------------------------------------------------------------------
    // Access control
    // -----------------------------------------------------------------------
    function test_proposeChange_NotController() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(anyone);
        vm.expectRevert(UsdcSplit.NotController.selector);
        split.proposeChange(id, accs, bps);
    }

    function test_cancelChange_NotController() public {
        uint256 id = _createManaged(alice, bob);
        vm.prank(anyone);
        vm.expectRevert(UsdcSplit.NotController.selector);
        split.cancelChange(id);
    }

    function test_lockSplit_NotController() public {
        uint256 id = _createManaged(alice, bob);
        vm.prank(anyone);
        vm.expectRevert(UsdcSplit.NotController.selector);
        split.lockSplit(id);
    }

    // -----------------------------------------------------------------------
    // lockSplit
    // -----------------------------------------------------------------------
    function test_lockSplit_clearsController() public {
        uint256 id = _createManaged(alice, bob);

        // Arm a pending change first
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);

        vm.expectEmit(true, false, false, false);
        emit UsdcSplit.ChangeCancelled(id);
        vm.expectEmit(true, false, false, false);
        emit UsdcSplit.SplitLocked(id);
        vm.prank(ctrl); split.lockSplit(id);

        UsdcSplit.Split memory s = split.getSplit(id);
        assertEq(s.controller, address(0));
        assertEq(s.changeDelay, 0);
        assertEq(s.pendingEta, 0);

        // Cannot propose after lock
        vm.prank(ctrl);
        vm.expectRevert(UsdcSplit.NotController.selector);
        split.proposeChange(id, accs, bps);

        // Cannot lock again
        vm.prank(ctrl);
        vm.expectRevert(UsdcSplit.NotController.selector);
        split.lockSplit(id);
    }

    function test_lockSplit_noPending_noExtraCancelEvent() public {
        uint256 id = _createManaged(alice, bob);
        // Just lock with no pending change
        vm.prank(ctrl);
        vm.recordLogs();
        split.lockSplit(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // Only SplitLocked emitted (no ChangeCancelled)
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], UsdcSplit.SplitLocked.selector);
    }

    // -----------------------------------------------------------------------
    // payAtVersion happy path
    // -----------------------------------------------------------------------
    function test_payAtVersion_success() public {
        uint256 id = _createManaged(alice, bob);
        vm.prank(payer);
        uint256 no = split.payAtVersion{value: 1 ether}(id, "inv", 1);
        assertEq(no, 1);
    }

    function test_payAtVersion_VersionChanged() public {
        uint256 id = _createManaged(alice, bob);
        // Change version
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);
        (, , uint64 eta) = split.getPendingChange(id);
        vm.warp(eta);
        split.executeChange(id);
        // Now version == 2, payAtVersion with 1 reverts
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.VersionChanged.selector);
        split.payAtVersion{value: 1 ether}(id, "", 1);
    }

    // -----------------------------------------------------------------------
    // ChangeProposed and ChangeExecuted events
    // -----------------------------------------------------------------------
    function test_changeProposed_event() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        uint64 expectedEta = uint64(block.timestamp) + DELAY;
        vm.expectEmit(true, false, false, true);
        emit UsdcSplit.ChangeProposed(id, expectedEta, accs, bps);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);
    }

    function test_changeExecuted_event() public {
        uint256 id = _createManaged(alice, bob);
        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);
        (, , uint64 eta) = split.getPendingChange(id);
        vm.warp(eta);
        vm.expectEmit(true, false, false, true);
        emit UsdcSplit.ChangeExecuted(id, 2, accs, bps);
        split.executeChange(id);
    }

    // -----------------------------------------------------------------------
    // splitsByRecipient updated on change (new recipients added)
    // -----------------------------------------------------------------------
    function test_splitsByRecipient_updatedOnChange() public {
        uint256 id = _createManaged(alice, bob);
        // carol not in split yet
        assertEq(split.recipientSplitCount(carol), 0);

        (address[] memory accs, uint16[] memory bps) = _newTable(carol, dave);
        vm.prank(ctrl); split.proposeChange(id, accs, bps);
        (, , uint64 eta) = split.getPendingChange(id);
        vm.warp(eta);
        split.executeChange(id);

        // carol is now indexed
        assertEq(split.recipientSplitCount(carol), 1);
        assertEq(split.splitsByRecipient(carol)[0], id);
        // alice still indexed (was in original table)
        assertEq(split.recipientSplitCount(alice), 1);
    }

    // -----------------------------------------------------------------------
    // NoPendingChange on executeChange
    // -----------------------------------------------------------------------
    function test_executeChange_NoPendingChange() public {
        uint256 id = _createManaged(alice, bob);
        vm.expectRevert(UsdcSplit.NoPendingChange.selector);
        split.executeChange(id);
    }
}
