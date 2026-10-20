// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {UsdcSplit} from "../UsdcSplit.sol";
import {RevertReceiver, GasBurner, BigRevertReceiver, AcceptReceiver} from "../test-helpers/SplitHelpers.sol";

contract UsdcSplitTest is Test {
    UsdcSplit internal split;

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal dave    = makeAddr("dave");
    address internal payer   = makeAddr("payer");
    address internal ctrl    = makeAddr("controller");
    address internal anyone  = makeAddr("anyone");

    RevertReceiver  internal rv;
    GasBurner       internal gb;
    BigRevertReceiver internal br;
    AcceptReceiver  internal ar;

    uint64 constant DELAY = 120;

    function setUp() public {
        split = new UsdcSplit();
        rv = new RevertReceiver();
        gb = new GasBurner();
        br = new BigRevertReceiver();
        ar = new AcceptReceiver();
        vm.deal(payer, 100 ether);
        vm.deal(anyone, 1 ether);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------
    function _two(address a, address b) internal pure returns (address[] memory accs, uint16[] memory bps) {
        accs = new address[](2); bps = new uint16[](2);
        accs[0] = a; accs[1] = b; bps[0] = 5000; bps[1] = 5000;
    }
    function _three(address a, address b, address c, uint16 b0, uint16 b1, uint16 b2)
        internal pure returns (address[] memory accs, uint16[] memory bps)
    {
        accs = new address[](3); bps = new uint16[](3);
        accs[0] = a; accs[1] = b; accs[2] = c;
        bps[0] = b0; bps[1] = b1; bps[2] = b2;
    }

    // -----------------------------------------------------------------------
    // createSplit – happy paths
    // -----------------------------------------------------------------------
    function test_createSplit_two() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        uint256 id = split.createSplit("test", accs, bps, address(0), 0);
        assertEq(id, 1);
        UsdcSplit.Split memory s = split.getSplit(id);
        assertEq(s.creator, address(this));
        assertEq(s.version, 1);
        assertEq(s.controller, address(0));
        (address[] memory ra,) = split.getRecipients(id);
        assertEq(ra[0], alice); assertEq(ra[1], bob);
    }

    function test_createSplit_twenty() public {
        address[] memory accs = new address[](20);
        uint16[]  memory bps  = new uint16[](20);
        for (uint256 i = 0; i < 20; i++) {
            accs[i] = address(uint160(0x1000 + i));
            bps[i]  = 500; // 20 * 500 = 10000
        }
        uint256 id = split.createSplit("big", accs, bps, address(0), 0);
        assertEq(id, 1);
    }

    function test_createSplit_indexing() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        split.createSplit("t", accs, bps, address(0), 0);
        uint256[] memory byCreator = split.splitsByCreator(address(this));
        assertEq(byCreator.length, 1); assertEq(byCreator[0], 1);
        uint256[] memory byAlice = split.splitsByRecipient(alice);
        assertEq(byAlice.length, 1); assertEq(byAlice[0], 1);
        assertEq(split.recipientSplitCount(alice), 1);
    }

    function test_createSplit_idStartsAtOne() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        assertEq(split.splitCount(), 0);
        split.createSplit("a", accs, bps, address(0), 0);
        assertEq(split.splitCount(), 1);
        split.createSplit("b", accs, bps, address(0), 0);
        assertEq(split.splitCount(), 2);
    }

    // -----------------------------------------------------------------------
    // createSplit – reverts
    // -----------------------------------------------------------------------
    function test_createSplit_LabelTooLong() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        string memory longLabel = new string(65);
        vm.expectRevert(UsdcSplit.LabelTooLong.selector);
        split.createSplit(longLabel, accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidRecipients_tooFew() public {
        address[] memory accs = new address[](1);
        uint16[]  memory bps  = new uint16[](1);
        accs[0] = alice; bps[0] = 10000;
        vm.expectRevert(UsdcSplit.InvalidRecipients.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidRecipients_tooMany() public {
        address[] memory accs = new address[](21);
        uint16[]  memory bps  = new uint16[](21);
        for (uint256 i = 0; i < 21; i++) { accs[i] = address(uint160(0x2000 + i)); bps[i] = 476; }
        bps[0] = 476 + 4; // sum=10000
        vm.expectRevert(UsdcSplit.InvalidRecipients.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidRecipients_lengthMismatch() public {
        address[] memory accs = new address[](2);
        uint16[]  memory bps  = new uint16[](3);
        accs[0] = alice; accs[1] = bob;
        bps[0] = 3334; bps[1] = 3333; bps[2] = 3333;
        vm.expectRevert(UsdcSplit.InvalidRecipients.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_ZeroAddress() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = address(0); accs[1] = alice; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.ZeroAddress.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidRecipients_selfAddress() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = address(split); accs[1] = alice; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.InvalidRecipients.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_DuplicateRecipient() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = alice; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.DuplicateRecipient.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidShares_zeroBps() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 0; bps[1] = 10000;
        vm.expectRevert(UsdcSplit.InvalidShares.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidShares_wrongSum() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 5000; bps[1] = 4999;
        vm.expectRevert(UsdcSplit.InvalidShares.selector);
        split.createSplit("x", accs, bps, address(0), 0);
    }

    function test_createSplit_InvalidController() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.InvalidController.selector);
        split.createSplit("x", accs, bps, address(split), DELAY);
    }

    function test_createSplit_InvalidDelay_zeroControllerNonzeroDelay() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.InvalidDelay.selector);
        split.createSplit("x", accs, bps, address(0), 60);
    }

    function test_createSplit_InvalidDelay_tooShort() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.InvalidDelay.selector);
        split.createSplit("x", accs, bps, ctrl, 59);
    }

    function test_createSplit_InvalidDelay_tooLong() public {
        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = alice; accs[1] = bob; bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(UsdcSplit.InvalidDelay.selector);
        split.createSplit("x", accs, bps, ctrl, uint64(30 days) + 1);
    }

    function test_createSplit_validDelayBoundaries() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        split.createSplit("min", accs, bps, ctrl, 60);
        split.createSplit("max", accs, bps, ctrl, uint64(30 days));
    }

    // -----------------------------------------------------------------------
    // SplitCreated event
    // -----------------------------------------------------------------------
    function test_createSplit_event() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        vm.expectEmit(true, true, true, true);
        emit UsdcSplit.SplitCreated(1, address(this), address(0), 0, "ev", accs, bps);
        split.createSplit("ev", accs, bps, address(0), 0);
    }

    // -----------------------------------------------------------------------
    // pay – reverts
    // -----------------------------------------------------------------------
    function _createBasic() internal returns (uint256 id) {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        id = split.createSplit("basic", accs, bps, address(0), 0);
    }

    function test_pay_UnknownSplit_zero() public {
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.UnknownSplit.selector);
        split.pay{value: 1 ether}(0, "");
    }

    function test_pay_UnknownSplit_pastCount() public {
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.UnknownSplit.selector);
        split.pay{value: 1 ether}(99, "");
    }

    function test_pay_ZeroAmount() public {
        uint256 id = _createBasic();
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.ZeroAmount.selector);
        split.pay{value: 0}(id, "");
    }

    function test_pay_MemoTooLong() public {
        uint256 id = _createBasic();
        string memory longMemo = new string(129);
        vm.prank(payer);
        vm.expectRevert(UsdcSplit.MemoTooLong.selector);
        split.pay{value: 1 ether}(id, longMemo);
    }

    function test_pay_emptyMemoOK() public {
        uint256 id = _createBasic();
        vm.prank(payer);
        split.pay{value: 1 ether}(id, "");
    }

    // -----------------------------------------------------------------------
    // pay – state updates
    // -----------------------------------------------------------------------
    function test_pay_paymentCountAndHeld() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 1 ether}(id, "inv1");
        UsdcSplit.Split memory s = split.getSplit(id);
        assertEq(s.paymentCount, 1);
        assertEq(s.totalReceived, 1 ether);
        assertEq(split.totalHeld(), 1 ether);
    }

    // -----------------------------------------------------------------------
    // Exact credit tests
    // -----------------------------------------------------------------------
    // 0.30 USDC into [5000, 3000, 2000]
    function test_exactCredit_30pct() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 5000, 3000, 2000);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer);
        split.pay{value: 300_000_000_000_000_000}(id, ""); // 0.30 * 1e18
        assertEq(split.withdrawable(id, alice), 150_000_000_000_000_000);
        assertEq(split.withdrawable(id, bob),    90_000_000_000_000_000);
        assertEq(split.withdrawable(id, carol),  60_000_000_000_000_000);
    }

    // 0.15 USDC into [3334, 3333, 3333]
    function test_exactCredit_thirds() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 3334, 3333, 3333);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer);
        split.pay{value: 150_000_000_000_000_000}(id, ""); // 0.15 * 1e18
        // bob: floor(0.15e18 * 3333 / 10000) = 49_995_000_000_000_000
        // carol: same
        // alice: 0.15e18 - 2 * 49_995_000_000_000_000 = 50_010_000_000_000_000
        assertEq(split.withdrawable(id, alice), 50_010_000_000_000_000);
        assertEq(split.withdrawable(id, bob),   49_995_000_000_000_000);
        assertEq(split.withdrawable(id, carol), 49_995_000_000_000_000);
    }

    // 1 wei into [5000, 3000, 2000]
    function test_exactCredit_1wei() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 5000, 3000, 2000);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer);
        split.pay{value: 1}(id, "");
        assertEq(split.withdrawable(id, alice), 1);
        assertEq(split.withdrawable(id, bob),   0);
        assertEq(split.withdrawable(id, carol), 0);
    }

    // 10 wei into [4000, 3000, 3000]
    function test_exactCredit_10wei() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 4000, 3000, 3000);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer);
        split.pay{value: 10}(id, "");
        assertEq(split.withdrawable(id, alice), 4);
        assertEq(split.withdrawable(id, bob),   3);
        assertEq(split.withdrawable(id, carol), 3);
    }

    // sum of credits == payment exactly
    function test_exactCredit_sumEqualsAmount() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 3334, 3333, 3333);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        uint256 amt = 1_000_000_000_000_000_007; // odd amount
        vm.prank(payer);
        split.pay{value: amt}(id, "");
        uint256 total = split.withdrawable(id, alice) + split.withdrawable(id, bob) + split.withdrawable(id, carol);
        assertEq(total, amt);
    }

    // -----------------------------------------------------------------------
    // Paid and Credited events
    // -----------------------------------------------------------------------
    function test_pay_events() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        uint256 id = split.createSplit("ev", accs, bps, address(0), 0);
        string memory memo = "inv-42";
        bytes32 memoHash = keccak256(bytes(memo));
        vm.prank(payer);
        // _creditPayment emits i>=1 first, then i==0 (remainder).
        // For a 2-recipient split [alice, bob], bob is index 1 so emitted first.
        vm.expectEmit(true, true, true, true);
        emit UsdcSplit.Credited(id, bob, 1, 5 ether);   // index 1 first
        vm.expectEmit(true, true, true, true);
        emit UsdcSplit.Credited(id, alice, 1, 5 ether); // index 0 (remainder) second
        vm.expectEmit(true, true, true, true);
        emit UsdcSplit.Paid(id, payer, memoHash, 1, 10 ether, 1, memo);
        split.pay{value: 10 ether}(id, memo);
    }

    // -----------------------------------------------------------------------
    // previewPayment
    // -----------------------------------------------------------------------
    function test_previewPayment_matchesPay() public {
        (address[] memory accs, uint16[] memory bps) = _three(alice, bob, carol, 3334, 3333, 3333);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        uint256 amt = 1 ether;
        (, uint256[] memory preview) = split.previewPayment(id, amt);
        vm.prank(payer);
        split.pay{value: amt}(id, "");
        assertEq(preview[0], split.withdrawable(id, alice));
        assertEq(preview[1], split.withdrawable(id, bob));
        assertEq(preview[2], split.withdrawable(id, carol));
    }

    function test_previewPayment_unknownReturnsEmpty() public view {
        (address[] memory a, uint256[] memory b) = split.previewPayment(99, 1 ether);
        assertEq(a.length, 0); assertEq(b.length, 0);
    }

    // -----------------------------------------------------------------------
    // withdraw
    // -----------------------------------------------------------------------
    function test_withdraw_basic() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        uint256 before = alice.balance;
        vm.prank(alice); split.withdraw(id);
        assertEq(alice.balance - before, 1 ether);
        assertEq(split.withdrawable(id, alice), 0);
        assertEq(split.totalHeld(), 1 ether); // bob's share still held
    }

    function test_withdraw_NothingToWithdraw() public {
        uint256 id = _createBasic();
        vm.prank(alice);
        vm.expectRevert(UsdcSplit.NothingToWithdraw.selector);
        split.withdraw(id);
    }

    function test_withdraw_UnknownSplit() public {
        vm.expectRevert(UsdcSplit.UnknownSplit.selector);
        split.withdraw(99);
    }

    function test_withdraw_TransferFailed() public {
        // rv is a recipient that always reverts on receive
        (address[] memory accs, uint16[] memory bps) = _two(address(rv), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        vm.prank(address(rv));
        vm.expectRevert(UsdcSplit.TransferFailed.selector);
        split.withdraw(id);
    }

    function test_withdraw_event() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        vm.expectEmit(true, true, false, true);
        emit UsdcSplit.Withdrawn(id, alice, 1 ether, alice);
        vm.prank(alice); split.withdraw(id);
    }

    // -----------------------------------------------------------------------
    // release
    // -----------------------------------------------------------------------
    function test_release_anyoneCan() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        uint256 before = alice.balance;
        vm.prank(anyone); split.release(id, alice);
        assertEq(alice.balance - before, 1 ether);
    }

    function test_release_NothingToWithdraw() public {
        uint256 id = _createBasic();
        vm.expectRevert(UsdcSplit.NothingToWithdraw.selector);
        split.release(id, alice);
    }

    function test_release_TransferFailed() public {
        (address[] memory accs, uint16[] memory bps) = _two(address(rv), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        vm.expectRevert(UsdcSplit.TransferFailed.selector);
        split.release(id, address(rv));
    }

    function test_release_event() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        vm.expectEmit(true, true, false, true);
        emit UsdcSplit.Withdrawn(id, alice, 1 ether, anyone);
        vm.prank(anyone); split.release(id, alice);
    }

    // -----------------------------------------------------------------------
    // distribute
    // -----------------------------------------------------------------------
    function test_distribute_basic() public {
        uint256 id = _createBasic(); // alice 50%, bob 50%
        vm.prank(payer); split.pay{value: 4 ether}(id, "");
        uint256 ab = alice.balance; uint256 bb = bob.balance;
        vm.prank(anyone);
        (uint256 paid, uint256 skipped) = split.distribute(id);
        assertEq(paid, 4 ether); assertEq(skipped, 0);
        assertEq(alice.balance - ab, 2 ether);
        assertEq(bob.balance - bb, 2 ether);
        assertEq(split.totalHeld(), 0);
    }

    function test_distribute_NothingToWithdraw() public {
        uint256 id = _createBasic();
        vm.prank(anyone);
        vm.expectRevert(UsdcSplit.NothingToWithdraw.selector);
        split.distribute(id);
    }

    function test_distribute_skipsRevertReceiver() public {
        (address[] memory accs, uint16[] memory bps) = _two(address(rv), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        uint256 bb = bob.balance;
        vm.expectEmit(true, true, false, true);
        emit UsdcSplit.TransferSkipped(id, address(rv), 1 ether);
        (uint256 paid, uint256 skipped) = split.distribute(id);
        assertEq(paid, 1 ether); assertEq(skipped, 1);
        assertEq(bob.balance - bb, 1 ether);
        // rv credit kept
        assertEq(split.withdrawable(id, address(rv)), 1 ether);
    }

    function test_distribute_skipsGasBurner() public {
        (address[] memory accs, uint16[] memory bps) = _two(address(gb), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        (uint256 paid, uint256 skipped) = split.distribute(id);
        assertEq(skipped, 1); assertEq(paid, 1 ether);
        assertEq(split.withdrawable(id, address(gb)), 1 ether);
    }

    function test_distribute_skipsBigRevertReceiver() public {
        (address[] memory accs, uint16[] memory bps) = _two(address(br), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        (uint256 paid, uint256 skipped) = split.distribute(id);
        assertEq(skipped, 1); assertEq(paid, 1 ether);
        assertEq(split.withdrawable(id, address(br)), 1 ether);
    }

    function test_distribute_skippedCreditKeptAndWithdrawable() public {
        (address[] memory accs, uint16[] memory bps) = _two(address(rv), bob);
        uint256 id = split.createSplit("t", accs, bps, address(0), 0);
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        split.distribute(id); // rv skipped
        // rv can still be released later via release(); just check withdrawable is intact
        assertEq(split.withdrawable(id, address(rv)), 1 ether);
    }

    function test_distribute_Withdrawn_event() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 2 ether}(id, "");
        vm.expectEmit(true, true, false, true);
        emit UsdcSplit.Withdrawn(id, alice, 1 ether, anyone);
        vm.prank(anyone); split.distribute(id);
    }

    // -----------------------------------------------------------------------
    // Force-send: vm.deal doesn't affect accounting
    // -----------------------------------------------------------------------
    function test_forceSend_noEffect() public {
        uint256 id = _createBasic();
        vm.prank(payer); split.pay{value: 1 ether}(id, "");
        uint256 heldBefore = split.totalHeld();
        // force-send extra balance
        vm.deal(address(split), address(split).balance + 5 ether);
        assertEq(split.totalHeld(), heldBefore);
        UsdcSplit.Split memory s = split.getSplit(id);
        assertEq(s.totalReceived, 1 ether);
        // balance >= totalHeld (extra from force-send)
        assertGe(address(split).balance, split.totalHeld());
    }

    // -----------------------------------------------------------------------
    // Views – unknown ids never revert
    // -----------------------------------------------------------------------
    function test_views_unknownDoNotRevert() public view {
        split.getSplit(999);
        split.getRecipients(999);
        split.getPendingChange(999);
        split.getAccount(999, alice);
        split.withdrawable(999, alice);
        split.previewPayment(999, 1 ether);
        split.splitsByCreator(alice);
        split.splitsByRecipient(alice);
        split.recipientSplitCount(alice);
        split.recipientSplitsPage(alice, 0, 10);
    }

    function test_recipientSplitsPage_pagination() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        split.createSplit("a", accs, bps, address(0), 0);
        split.createSplit("b", accs, bps, address(0), 0);
        split.createSplit("c", accs, bps, address(0), 0);
        uint256[] memory page = split.recipientSplitsPage(alice, 1, 2);
        assertEq(page.length, 2);
        assertEq(page[0], 2); assertEq(page[1], 3);
    }

    function test_recipientSplitsPage_pastEnd() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        split.createSplit("a", accs, bps, address(0), 0);
        uint256[] memory page = split.recipientSplitsPage(alice, 5, 10);
        assertEq(page.length, 0);
    }

    function test_recipientSplitsPage_hugeLimitClamped() public {
        (address[] memory accs, uint16[] memory bps) = _two(alice, bob);
        split.createSplit("a", accs, bps, address(0), 0);
        uint256[] memory page = split.recipientSplitsPage(alice, 0, type(uint256).max);
        assertEq(page.length, 1);
    }
}
