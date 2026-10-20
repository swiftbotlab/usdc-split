// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UsdcSplit
/// @notice Native-USDC split contract for Arc: immutable-by-default split tables, pull-based withdrawals,
///         optional delayed controller updates for future payments only, and push distribution with per-recipient skip-on-failure.
/// @dev Rules summary:
///      - Payments are credited instantly to recipient accounts using basis points that sum to 10,000.
///      - For each payment, recipients i>=1 get floor(amount*bps/10000), recipient[0] gets the remainder.
///      - Credits are accounting-only until withdrawn/released/distributed.
///      - Split table changes are delayed and affect future payments only; historical account balances are never rewritten.
contract UsdcSplit is ReentrancyGuard {
    struct Recipient {
        address account;
        uint16 bps;
    }

    struct Split {
        address creator;
        address controller;
        uint64 changeDelay;
        uint64 createdAt;
        uint32 version;
        uint64 pendingEta;
        uint256 totalReceived;
        uint256 totalWithdrawn;
        uint256 paymentCount;
        string label;
    }

    struct Account {
        uint256 earned;
        uint256 withdrawn;
    }

    uint256 public constant MIN_RECIPIENTS = 2;
    uint256 public constant MAX_RECIPIENTS = 20;
    uint256 public constant TOTAL_BPS = 10000;
    uint256 public constant MAX_LABEL_BYTES = 64;
    uint256 public constant MAX_MEMO_BYTES = 128;
    uint64 public constant MIN_CHANGE_DELAY = 60;
    uint64 public constant MAX_CHANGE_DELAY = 30 days;
    uint64 public constant CHANGE_GRACE = 7 days;
    uint256 public constant PUSH_GAS = 50000;

    error UnknownSplit();
    error InvalidRecipients();
    error ZeroAddress();
    error DuplicateRecipient();
    error InvalidShares();
    error LabelTooLong();
    error MemoTooLong();
    error InvalidDelay();
    error InvalidController();
    error ZeroAmount();
    error NothingToWithdraw();
    error TransferFailed();
    error NotController();
    error NoPendingChange();
    error ChangeNotReady();
    error ChangeExpired();
    error VersionChanged();

    event SplitCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed controller,
        uint64 changeDelay,
        string label,
        address[] accounts,
        uint16[] bps
    );
    event Paid(
        uint256 indexed id,
        address indexed payer,
        bytes32 indexed memoHash,
        uint256 paymentNo,
        uint256 amount,
        uint32 version,
        string memo
    );
    event Credited(uint256 indexed id, address indexed account, uint256 indexed paymentNo, uint256 amount);
    event Withdrawn(uint256 indexed id, address indexed account, uint256 amount, address caller);
    event TransferSkipped(uint256 indexed id, address indexed account, uint256 amount);
    event ChangeProposed(uint256 indexed id, uint64 eta, address[] accounts, uint16[] bps);
    event ChangeCancelled(uint256 indexed id);
    event ChangeExecuted(uint256 indexed id, uint32 version, address[] accounts, uint16[] bps);
    event SplitLocked(uint256 indexed id);

    mapping(uint256 => Split) private _splits;
    mapping(uint256 => Recipient[]) private _recipients;
    mapping(uint256 => Recipient[]) private _pendingRecipients;
    mapping(uint256 => mapping(address => Account)) private _accounts;
    mapping(address => uint256[]) private _splitsByCreator;
    mapping(address => uint256[]) private _splitsByRecipient;
    mapping(address => mapping(uint256 => bool)) private _recipientInSplit;

    uint256 private _splitCount;
    uint256 private _totalHeld;

    /// @notice Creates a new split table.
    /// @param label Human-readable split label (max 64 bytes).
    /// @param accounts Recipient addresses.
    /// @param bps Recipient basis points, summing to 10,000.
    /// @param controller Optional controller that can propose delayed table changes.
    /// @param changeDelay Delay in seconds before a proposed change becomes executable.
    /// @return id Newly created split id (starts at 1).
    function createSplit(
        string calldata label,
        address[] calldata accounts,
        uint16[] calldata bps,
        address controller,
        uint64 changeDelay
    ) external nonReentrant returns (uint256 id) {
        if (bytes(label).length > MAX_LABEL_BYTES) revert LabelTooLong();
        _validateRecipients(accounts, bps);

        if (controller == address(this)) revert InvalidController();
        if (controller == address(0)) {
            if (changeDelay != 0) revert InvalidDelay();
        } else {
            if (changeDelay < MIN_CHANGE_DELAY || changeDelay > MAX_CHANGE_DELAY) revert InvalidDelay();
        }

        id = ++_splitCount;

        Split storage split = _splits[id];
        split.creator = msg.sender;
        split.controller = controller;
        split.changeDelay = changeDelay;
        split.createdAt = uint64(block.timestamp);
        split.version = 1;
        split.label = label;

        _setRecipientsFromCalldata(_recipients[id], accounts, bps);

        _splitsByCreator[msg.sender].push(id);
        uint256 len = accounts.length;
        for (uint256 i = 0; i < len; ++i) {
            address account = accounts[i];
            if (!_recipientInSplit[account][id]) {
                _recipientInSplit[account][id] = true;
                _splitsByRecipient[account].push(id);
            }
        }

        emit SplitCreated(id, msg.sender, controller, changeDelay, label, accounts, bps);
    }

    /// @notice Pays native USDC into a split and credits all recipients using the current table.
    /// @param id Split id.
    /// @param memo Payment memo (max 128 bytes).
    /// @return paymentNo New payment sequence number for this split.
    function pay(uint256 id, string calldata memo) external payable nonReentrant returns (uint256 paymentNo) {
        _requireKnownSplit(id);
        if (msg.value == 0) revert ZeroAmount();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();

        Split storage split = _splits[id];
        paymentNo = ++split.paymentCount;
        split.totalReceived += msg.value;
        _totalHeld += msg.value;

        _creditPayment(id, paymentNo, msg.value);

        emit Paid(id, msg.sender, keccak256(bytes(memo)), paymentNo, msg.value, split.version, memo);
    }

    /// @notice Pays native USDC into a split only if the current split version matches `expectedVersion`.
    /// @param id Split id.
    /// @param memo Payment memo (max 128 bytes).
    /// @param expectedVersion Caller-expected split version.
    /// @return paymentNo New payment sequence number for this split.
    function payAtVersion(
        uint256 id,
        string calldata memo,
        uint32 expectedVersion
    ) external payable nonReentrant returns (uint256 paymentNo) {
        _requireKnownSplit(id);
        Split storage split = _splits[id];
        if (split.version != expectedVersion) revert VersionChanged();
        if (msg.value == 0) revert ZeroAmount();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();

        paymentNo = ++split.paymentCount;
        split.totalReceived += msg.value;
        _totalHeld += msg.value;

        _creditPayment(id, paymentNo, msg.value);

        emit Paid(id, msg.sender, keccak256(bytes(memo)), paymentNo, msg.value, split.version, memo);
    }

    /// @notice Withdraws the caller's accrued balance from a split.
    /// @param id Split id.
    /// @return amount Amount transferred to the caller.
    function withdraw(uint256 id) external nonReentrant returns (uint256 amount) {
        _requireKnownSplit(id);

        Account storage accountData = _accounts[id][msg.sender];
        amount = accountData.earned - accountData.withdrawn;
        if (amount == 0) revert NothingToWithdraw();

        accountData.withdrawn += amount;

        Split storage split = _splits[id];
        split.totalWithdrawn += amount;
        _totalHeld -= amount;

        emit Withdrawn(id, msg.sender, amount, msg.sender);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Releases an account's accrued balance from a split to that account.
    /// @param id Split id.
    /// @param account Recipient account to release.
    /// @return amount Amount transferred to `account`.
    function release(uint256 id, address account) external nonReentrant returns (uint256 amount) {
        _requireKnownSplit(id);

        Account storage accountData = _accounts[id][account];
        amount = accountData.earned - accountData.withdrawn;
        if (amount == 0) revert NothingToWithdraw();

        accountData.withdrawn += amount;

        Split storage split = _splits[id];
        split.totalWithdrawn += amount;
        _totalHeld -= amount;

        emit Withdrawn(id, account, amount, msg.sender);

        (bool ok, ) = payable(account).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Pushes withdrawable balances to all current recipients using capped gas per transfer.
    /// @param id Split id.
    /// @return paid Total amount successfully transferred.
    /// @return skipped Number of recipients whose transfer failed and was skipped.
    function distribute(uint256 id) external nonReentrant returns (uint256 paid, uint256 skipped) {
        _requireKnownSplit(id);

        Recipient[] storage list = _recipients[id];
        uint256 len = list.length;

        bool anyOwed;
        for (uint256 i = 0; i < len; ++i) {
            Recipient storage r0 = list[i];
            Account storage a0 = _accounts[id][r0.account];
            if (a0.earned > a0.withdrawn) {
                anyOwed = true;
                break;
            }
        }
        if (!anyOwed) revert NothingToWithdraw();

        Split storage split = _splits[id];
        uint256 gasAmount = PUSH_GAS;

        for (uint256 i = 0; i < len; ++i) {
            address account = list[i].account;
            Account storage accountData = _accounts[id][account];
            uint256 amount = accountData.earned - accountData.withdrawn;
            if (amount == 0) continue;

            accountData.withdrawn += amount;
            split.totalWithdrawn += amount;
            _totalHeld -= amount;

            bool ok;
            assembly {
                ok := call(gasAmount, account, amount, 0, 0, 0, 0)
            }

            if (ok) {
                paid += amount;
                emit Withdrawn(id, account, amount, msg.sender);
            } else {
                accountData.withdrawn -= amount;
                split.totalWithdrawn -= amount;
                _totalHeld += amount;
                unchecked {
                    ++skipped;
                }
                emit TransferSkipped(id, account, amount);
            }
        }
    }

    /// @notice Proposes a delayed recipient-table change for future payments.
    /// @param id Split id.
    /// @param accounts New recipient addresses.
    /// @param bps New recipient basis points, summing to 10,000.
    function proposeChange(uint256 id, address[] calldata accounts, uint16[] calldata bps) external nonReentrant {
        _requireKnownSplit(id);
        Split storage split = _splits[id];
        if (split.controller == address(0) || msg.sender != split.controller) revert NotController();

        _validateRecipients(accounts, bps);

        _setRecipientsFromCalldata(_pendingRecipients[id], accounts, bps);

        uint64 eta = uint64(block.timestamp) + split.changeDelay;
        split.pendingEta = eta;

        emit ChangeProposed(id, eta, accounts, bps);
    }

    /// @notice Cancels any pending table change.
    /// @param id Split id.
    function cancelChange(uint256 id) external nonReentrant {
        _requireKnownSplit(id);
        Split storage split = _splits[id];
        if (split.controller == address(0) || msg.sender != split.controller) revert NotController();
        if (split.pendingEta == 0) revert NoPendingChange();

        delete _pendingRecipients[id];
        split.pendingEta = 0;

        emit ChangeCancelled(id);
    }

    /// @notice Executes a pending table change once ready and before grace expiry.
    /// @param id Split id.
    function executeChange(uint256 id) external nonReentrant {
        _requireKnownSplit(id);

        Split storage split = _splits[id];
        uint64 eta = split.pendingEta;
        if (eta == 0) revert NoPendingChange();

        uint256 ts = block.timestamp;
        if (ts < eta) revert ChangeNotReady();
        if (ts > uint256(eta) + CHANGE_GRACE) revert ChangeExpired();

        Recipient[] storage pending = _pendingRecipients[id];

        delete _recipients[id];
        Recipient[] storage current = _recipients[id];
        uint256 len = pending.length;
        for (uint256 i = 0; i < len; ++i) {
            Recipient memory r = pending[i];
            current.push(r);
            if (!_recipientInSplit[r.account][id]) {
                _recipientInSplit[r.account][id] = true;
                _splitsByRecipient[r.account].push(id);
            }
        }

        delete _pendingRecipients[id];
        split.pendingEta = 0;
        split.version += 1;

        (address[] memory accounts, uint16[] memory bps) = _recipientArrays(current);
        emit ChangeExecuted(id, split.version, accounts, bps);
    }

    /// @notice Irreversibly removes controller privileges and clears any pending change.
    /// @param id Split id.
    function lockSplit(uint256 id) external nonReentrant {
        _requireKnownSplit(id);
        Split storage split = _splits[id];
        if (split.controller == address(0) || msg.sender != split.controller) revert NotController();

        split.controller = address(0);
        split.changeDelay = 0;

        if (split.pendingEta != 0) {
            delete _pendingRecipients[id];
            split.pendingEta = 0;
            emit ChangeCancelled(id);
        }

        emit SplitLocked(id);
    }

    /// @notice Returns split metadata.
    /// @dev Never reverts; unknown ids return zero-initialized fields.
    /// @param id Split id.
    /// @return Split struct in the exact declared field order.
    function getSplit(uint256 id) external view returns (Split memory) {
        return _splits[id];
    }

    /// @notice Returns the current recipient table for a split.
    /// @dev Never reverts; unknown ids return empty arrays.
    /// @param id Split id.
    /// @return accounts Recipient addresses.
    /// @return bps Recipient basis points.
    function getRecipients(uint256 id) external view returns (address[] memory accounts, uint16[] memory bps) {
        return _recipientArrays(_recipients[id]);
    }

    /// @notice Returns the pending recipient table and ETA for a split.
    /// @dev Never reverts; unknown ids return empty arrays and eta=0.
    /// @param id Split id.
    /// @return accounts Pending recipient addresses.
    /// @return bps Pending recipient basis points.
    /// @return eta Pending execution time.
    function getPendingChange(
        uint256 id
    ) external view returns (address[] memory accounts, uint16[] memory bps, uint64 eta) {
        (accounts, bps) = _recipientArrays(_pendingRecipients[id]);
        eta = _splits[id].pendingEta;
    }

    /// @notice Returns earned and withdrawn amounts for an account in a split.
    /// @dev Never reverts; unknown ids return zeros.
    /// @param id Split id.
    /// @param account Account address.
    /// @return earned Total credited amount.
    /// @return withdrawn Total withdrawn amount.
    function getAccount(uint256 id, address account) external view returns (uint256 earned, uint256 withdrawn) {
        Account storage a = _accounts[id][account];
        earned = a.earned;
        withdrawn = a.withdrawn;
    }

    /// @notice Returns currently withdrawable amount for an account in a split.
    /// @dev Never reverts; unknown ids return zero.
    /// @param id Split id.
    /// @param account Account address.
    /// @return Amount available to withdraw.
    function withdrawable(uint256 id, address account) external view returns (uint256) {
        Account storage a = _accounts[id][account];
        return a.earned - a.withdrawn;
    }

    /// @notice Previews per-recipient credit amounts for a hypothetical payment.
    /// @dev Never reverts; returns empty arrays for unknown splits or empty tables.
    /// @param id Split id.
    /// @param amount Hypothetical payment amount.
    /// @return accounts Current recipient addresses.
    /// @return amounts Corresponding credited amounts following the exact runtime credit rule.
    function previewPayment(
        uint256 id,
        uint256 amount
    ) external view returns (address[] memory accounts, uint256[] memory amounts) {
        if (id == 0 || id > _splitCount) {
            return (new address[](0), new uint256[](0));
        }

        Recipient[] storage list = _recipients[id];
        uint256 len = list.length;
        if (len == 0) {
            return (new address[](0), new uint256[](0));
        }

        accounts = new address[](len);
        amounts = new uint256[](len);

        uint256 othersTotal;
        for (uint256 i = 1; i < len; ++i) {
            Recipient storage r = list[i];
            accounts[i] = r.account;
            uint256 part = (amount * uint256(r.bps)) / TOTAL_BPS;
            amounts[i] = part;
            othersTotal += part;
        }

        Recipient storage r0 = list[0];
        accounts[0] = r0.account;
        amounts[0] = amount - othersTotal;
    }

    /// @notice Returns all split ids created by `creator`.
    /// @param creator Creator address.
    /// @return ids Split ids.
    function splitsByCreator(address creator) external view returns (uint256[] memory ids) {
        return _splitsByCreator[creator];
    }

    /// @notice Returns all split ids in which `recipient` has ever appeared.
    /// @param recipient Recipient address.
    /// @return ids Split ids.
    function splitsByRecipient(address recipient) external view returns (uint256[] memory ids) {
        return _splitsByRecipient[recipient];
    }

    /// @notice Returns how many split ids are indexed for `account` as recipient.
    /// @param account Recipient address.
    /// @return Number of split ids.
    function recipientSplitCount(address account) external view returns (uint256) {
        return _splitsByRecipient[account].length;
    }

    /// @notice Returns a page of recipient-indexed split ids.
    /// @dev Returns empty when `start` is out of range and clamps oversized `limit` safely.
    /// @param account Recipient address.
    /// @param start Zero-based start index.
    /// @param limit Maximum number of entries to return.
    /// @return page Requested id page.
    function recipientSplitsPage(
        address account,
        uint256 start,
        uint256 limit
    ) external view returns (uint256[] memory page) {
        uint256[] storage source = _splitsByRecipient[account];
        uint256 len = source.length;

        if (start >= len) {
            return new uint256[](0);
        }

        uint256 remaining = len - start;
        uint256 count = limit;
        if (count > remaining) {
            count = remaining;
        }

        page = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            page[i] = source[start + i];
        }
    }

    /// @notice Returns total number of created splits.
    /// @return count Split count.
    function splitCount() external view returns (uint256 count) {
        return _splitCount;
    }

    /// @notice Returns total unwithdrawn credited amount across all splits.
    /// @return held Aggregate held amount.
    function totalHeld() external view returns (uint256 held) {
        return _totalHeld;
    }

    function _requireKnownSplit(uint256 id) private view {
        if (id == 0 || id > _splitCount) revert UnknownSplit();
    }

    function _validateRecipients(address[] calldata accounts, uint16[] calldata bps) private view {
        uint256 len = accounts.length;
        if (len != bps.length || len < MIN_RECIPIENTS || len > MAX_RECIPIENTS) revert InvalidRecipients();

        uint256 sum;
        for (uint256 i = 0; i < len; ++i) {
            address account = accounts[i];
            if (account == address(0)) revert ZeroAddress();
            if (account == address(this)) revert InvalidRecipients();

            for (uint256 j = i + 1; j < len; ++j) {
                if (account == accounts[j]) revert DuplicateRecipient();
            }

            uint16 share = bps[i];
            if (share == 0) revert InvalidShares();
            sum += share;
        }

        if (sum != TOTAL_BPS) revert InvalidShares();
    }

    function _setRecipientsFromCalldata(
        Recipient[] storage target,
        address[] calldata accounts,
        uint16[] calldata bps
    ) private {
        // Clear by popping (avoids delete-on-pointer restriction).
        uint256 existing = target.length;
        for (uint256 i = 0; i < existing; ++i) {
            target.pop();
        }
        uint256 len = accounts.length;
        for (uint256 i = 0; i < len; ++i) {
            target.push(Recipient({account: accounts[i], bps: bps[i]}));
        }
    }

    function _creditPayment(uint256 id, uint256 paymentNo, uint256 amount) private {
        Recipient[] storage list = _recipients[id];
        uint256 len = list.length;

        uint256 othersTotal;
        for (uint256 i = 1; i < len; ++i) {
            Recipient storage r = list[i];
            uint256 part = (amount * uint256(r.bps)) / TOTAL_BPS;
            if (part != 0) {
                _accounts[id][r.account].earned += part;
                emit Credited(id, r.account, paymentNo, part);
            }
            othersTotal += part;
        }

        Recipient storage r0 = list[0];
        uint256 firstPart = amount - othersTotal;
        if (firstPart != 0) {
            _accounts[id][r0.account].earned += firstPart;
            emit Credited(id, r0.account, paymentNo, firstPart);
        }
    }

    function _recipientArrays(
        Recipient[] storage list
    ) private view returns (address[] memory accounts, uint16[] memory bps) {
        uint256 len = list.length;
        accounts = new address[](len);
        bps = new uint16[](len);

        for (uint256 i = 0; i < len; ++i) {
            Recipient storage r = list[i];
            accounts[i] = r.account;
            bps[i] = r.bps;
        }
    }
}
