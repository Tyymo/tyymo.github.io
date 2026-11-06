import { int64 } from "./int64.js";

import {
    releaseFakeCell, fakeCellReleased,
    carrierHeaderCopy, carrierHomeVector
} from "./core.js?v=10";

// -----------------------------------------------------------------------------
// Private diagnostic storage for leakval cleanup failures.
// The exported facade returns fresh snapshots and is frozen below.
// The original thrown values are retained by reference intentionally.
// -----------------------------------------------------------------------------
const _lastLeakData = {
    primary: { set: false, source: null, value: undefined },
    restore: { set: false, source: null, value: undefined },
    clear:   { set: false, source: null, value: undefined }
};

function resetLastLeakErrors() {
    _lastLeakData.primary.set = false;
    _lastLeakData.primary.source = null;
    _lastLeakData.primary.value = undefined;
    _lastLeakData.restore.set = false;
    _lastLeakData.restore.source = null;
    _lastLeakData.restore.value = undefined;
    _lastLeakData.clear.set = false;
    _lastLeakData.clear.source = null;
    _lastLeakData.clear.value = undefined;
}

export const lastLeakErrors = {
    get primary() {
        return {
            set: _lastLeakData.primary.set,
            source: _lastLeakData.primary.source,
            value: _lastLeakData.primary.value
        };
    },
    get restore() {
        return {
            set: _lastLeakData.restore.set,
            source: _lastLeakData.restore.source,
            value: _lastLeakData.restore.value
        };
    },
    get clear() {
        return {
            set: _lastLeakData.clear.set,
            source: _lastLeakData.clear.source,
            value: _lastLeakData.clear.value
        };
    }
};
Object.freeze(lastLeakErrors);

// -----------------------------------------------------------------------------
// Error description helpers. Both functions are defensive: reading name or
// message and converting an arbitrary thrown value may itself execute code.
// -----------------------------------------------------------------------------
function safeDescribe(e) {
    if (e === null) return "null";
    if (e === undefined) return "undefined";
    try {
        const msg = e.message;
        if (typeof msg === "string") return msg;
    } catch (inner) {
        // Fall through to String conversion.
    }
    try {
        return String(e);
    } catch (inner) {
        return "<unprintable error>";
    }
}

function errorSummary(e) {
    if (e === null) return "null";
    if (e === undefined) return "undefined";
    try {
        if (typeof e === "object") {
            const name = e.name;
            const msg = e.message;
            if (typeof name === "string" && typeof msg === "string")
                return name + ": " + msg;
            if (typeof msg === "string")
                return msg;
        }
    } catch (inner) {
        // Fall through to safeDescribe.
    }
    return safeDescribe(e);
}

// -----------------------------------------------------------------------------
// Array helpers.
// Array index enumeration is proportional to the number of actual own
// properties, not arr.length; sparse arrays with huge lengths cannot cause a
// length-proportional scan. Accessor indices are rejected, not invoked.
// -----------------------------------------------------------------------------
function isArrayIndexKey(key) {
    if (typeof key !== "string" || key.length === 0)
        return false;

    const n = Number(key);
    return n >= 0
        && n <= 0xfffffffe
        && Math.floor(n) === n
        && String(n) === key;
}

function defineArrayValue(arr, key, value) {
    Object.defineProperty(arr, key, {
        value: value,
        writable: true,
        enumerable: true,
        configurable: true
    });
}

function copyArrayIndexProperties(source, target, who) {
    if (!Array.isArray(source))
        throw new TypeError(who + ": source is not an Array");
    if (!Array.isArray(target))
        throw new TypeError(who + ": target is not an Array");

    let sourceLength;
    let names;
    try {
        sourceLength = source.length;
        if (typeof sourceLength !== "number"
            || !Number.isFinite(sourceLength)
            || sourceLength < 0
            || Math.floor(sourceLength) !== sourceLength
            || sourceLength > 0xffffffff) {
            throw new TypeError(who + ": invalid source array length");
        }
        names = Object.getOwnPropertyNames(source);
    } catch (e) {
        throw new Error(who + ": cannot inspect source array: " + safeDescribe(e));
    }

    // Stage into a fresh ordinary Array first. If inspection fails, target is
    // untouched. The staged array preserves holes and the source length.
    const staged = [];
    try {
        for (let i = 0; i < names.length; ++i) {
            const key = names[i];
            if (!isArrayIndexKey(key))
                continue;

            const index = Number(key);
            if (index >= sourceLength)
                throw new RangeError(who + ": index exceeds source length");

            const desc = Object.getOwnPropertyDescriptor(source, key);
            if (!desc || !("value" in desc))
                throw new TypeError(who + ": accessor index is not accepted: " + key);

            defineArrayValue(staged, key, desc.value);
        }
        staged.length = sourceLength;
    } catch (e) {
        throw new Error(who + ": source snapshot failed: " + safeDescribe(e));
    }

    // Target is expected to be a module-owned ordinary Array for private
    // snapshots, or a prevalidated public Array for pairStatus.released.
    try {
        target.length = 0;
        const stagedNames = Object.getOwnPropertyNames(staged);
        for (let i = 0; i < stagedNames.length; ++i) {
            const key = stagedNames[i];
            if (isArrayIndexKey(key)) {
                const desc = Object.getOwnPropertyDescriptor(staged, key);
                defineArrayValue(target, key, desc.value);
            }
        }
        target.length = staged.length;
    } catch (e) {
        throw new Error(who + ": target update failed: " + safeDescribe(e));
    }

    return sourceLength;
}

// -----------------------------------------------------------------------------
// Internal release log. The public getter returns a detached Array snapshot.
// `recorded` means a valid `released` Array was copied successfully; it is not
// set merely because releaseFakeCell returned an object.
// -----------------------------------------------------------------------------
const internalReleaseLog = {
    returned: false,
    recorded: false,
    verified: false,
    publicRecordStored: false,
    released: [],
    historyCleared: false,
    snapshotErrorSet: false,
    snapshotError: undefined
};

export function getInternalReleaseLog() {
    const copy = [];
    copyArrayIndexProperties(
        internalReleaseLog.released,
        copy,
        "mem.getInternalReleaseLog"
    );
    return {
        returned: internalReleaseLog.returned,
        recorded: internalReleaseLog.recorded,
        verified: internalReleaseLog.verified,
        publicRecordStored: internalReleaseLog.publicRecordStored,
        released: copy,
        historyCleared: internalReleaseLog.historyCleared,
        snapshotErrorSet: internalReleaseLog.snapshotErrorSet,
        snapshotError: internalReleaseLog.snapshotError
    };
}

function resetInternalReleaseLog() {
    internalReleaseLog.returned = false;
    internalReleaseLog.recorded = false;
    internalReleaseLog.verified = false;
    internalReleaseLog.publicRecordStored = false;
    internalReleaseLog.released.length = 0;
    internalReleaseLog.historyCleared = false;
    internalReleaseLog.snapshotErrorSet = false;
    internalReleaseLog.snapshotError = undefined;
}

// -----------------------------------------------------------------------------
// Pair status is public diagnostics. It is not the authority for permanent
// failure: modulePermanentlyBroken is private and cannot be reset by callers.
// -----------------------------------------------------------------------------
export const pairStatus = {
    state: "not-attempted",
    promoted: false,

    committed: false,
    rolledBack: false,
    rollbackClean: null,
    fallback: false,
    stage: "not-attempted",
    failedAt: null,
    error: null,

    vectorOffset: -1,
    lengthOffset: -1,
    modeOffset: -1,
    butterflyOffset: -1,

    mainAddress: null,
    mainVector: null,
    mainRecordVector: null,
    mainWindow: -1,
    mainCellFromFakeSlot: null,
    mainIdentity: null,
    mainAtHome: null,
    mainViewFreed: false,

    workerAddress: null,
    workerVector: null,
    workerButterfly: null,
    workerWindow: -1,
    workerLength: -1,
    workerIdentity: null,
    workerMirrorFreed: false,

    structureID: -1,
    mode: -1,
    leakvalAgrees: false,

    fakeAddress: null,
    fakeButterfly: null,
    released: [],
    historyCleared: false
};

const PAIR_STATUS_RESET_FIELDS = [
    "state", "promoted", "committed", "rolledBack", "rollbackClean",
    "fallback", "stage", "failedAt", "error",
    "vectorOffset", "lengthOffset", "modeOffset", "butterflyOffset",
    "mainAddress", "mainVector", "mainRecordVector", "mainWindow",
    "mainCellFromFakeSlot", "mainIdentity", "mainAtHome", "mainViewFreed",
    "workerAddress", "workerVector", "workerButterfly", "workerWindow",
    "workerLength", "workerIdentity", "workerMirrorFreed",
    "structureID", "mode", "leakvalAgrees", "fakeAddress",
    "fakeButterfly", "historyCleared"
];

function getReleasedArrayReference() {
    const desc = Object.getOwnPropertyDescriptor(pairStatus, "released");
    if (!desc || !("value" in desc) || !desc.writable)
        throw new Error("pairStatus.released is not a writable own data property");
    return desc.value;
}

function validateReleasedArray(arr) {
    if (arguments.length === 0) {
        try {
            arr = getReleasedArrayReference();
        } catch (e) {
            return safeDescribe(e);
        }
    }

    if (!Array.isArray(arr))
        return "pairStatus.released is not an Array";

    try {
        if (!Object.isExtensible(arr))
            return "pairStatus.released is not extensible";

        const lenDesc = Object.getOwnPropertyDescriptor(arr, "length");
        if (!lenDesc || !lenDesc.writable)
            return "pairStatus.released.length is not writable";

        const curLen = arr.length;
        if (typeof curLen !== "number"
            || !Number.isFinite(curLen)
            || curLen < 0
            || Math.floor(curLen) !== curLen
            || curLen > 0xffffffff) {
            return "pairStatus.released.length is invalid";
        }

        // Examine actual own properties, not every possible array position.
        const names = Object.getOwnPropertyNames(arr);
        for (let i = 0; i < names.length; ++i) {
            const key = names[i];
            if (!isArrayIndexKey(key))
                continue;

            const desc = Object.getOwnPropertyDescriptor(arr, key);
            if (!desc)
                return "pairStatus.released[" + key + "] descriptor unavailable";
            if (!desc.configurable)
                return "pairStatus.released[" + key + "] is not configurable";
        }
        return null;
    } catch (e) {
        return "pairStatus.released validation failed: " + safeDescribe(e);
    }
}

function validatePairStatusResetFields() {
    for (let i = 0; i < PAIR_STATUS_RESET_FIELDS.length; ++i) {
        const key = PAIR_STATUS_RESET_FIELDS[i];
        let desc;
        try {
            desc = Object.getOwnPropertyDescriptor(pairStatus, key);
        } catch (e) {
            return "pairStatus." + key + " descriptor failed: " + safeDescribe(e);
        }
        if (!desc || !("value" in desc) || !desc.writable)
            return "pairStatus." + key + " is not a writable data property";
    }
    return null;
}

function resetPairStatus() {
    const arr = getReleasedArrayReference();
    const arrErr = validateReleasedArray(arr);
    if (arrErr !== null) {
        throw new Error("mem.resetPairStatus: " + arrErr
            + " (state corruption — refusing to proceed)");
    }

    const fieldsErr = validatePairStatusResetFields();
    if (fieldsErr !== null) {
        throw new Error("mem.resetPairStatus: " + fieldsErr
            + " (refusing to proceed)");
    }

    // No pairStatus fields are changed before the public list clears.
    try {
        arr.length = 0;
        if (arr.length !== 0)
            throw new Error("length assignment did not clear the array");
    } catch (e) {
        throw new Error("mem.resetPairStatus: cannot clear released array: "
            + safeDescribe(e));
    }

    // A Proxy could have run code while the length assignment was attempted.
    // Recheck the public reference and field descriptors before resetting.
    if (getReleasedArrayReference() !== arr)
        throw new Error("mem.resetPairStatus: released array reference changed");

    const fieldsErrAfter = validatePairStatusResetFields();
    if (fieldsErrAfter !== null)
        throw new Error("mem.resetPairStatus: state changed during reset: "
            + fieldsErrAfter);

    pairStatus.state = "not-attempted";
    pairStatus.promoted = false;
    pairStatus.committed = false;
    pairStatus.rolledBack = false;
    pairStatus.rollbackClean = null;
    pairStatus.fallback = false;
    pairStatus.stage = "not-attempted";
    pairStatus.failedAt = null;
    pairStatus.error = null;
    pairStatus.vectorOffset = -1;
    pairStatus.lengthOffset = -1;
    pairStatus.modeOffset = -1;
    pairStatus.butterflyOffset = -1;
    pairStatus.mainAddress = null;
    pairStatus.mainVector = null;
    pairStatus.mainRecordVector = null;
    pairStatus.mainWindow = -1;
    pairStatus.mainCellFromFakeSlot = null;
    pairStatus.mainIdentity = null;
    pairStatus.mainAtHome = null;
    pairStatus.mainViewFreed = false;
    pairStatus.workerAddress = null;
    pairStatus.workerVector = null;
    pairStatus.workerButterfly = null;
    pairStatus.workerWindow = -1;
    pairStatus.workerLength = -1;
    pairStatus.workerIdentity = null;
    pairStatus.workerMirrorFreed = false;
    pairStatus.structureID = -1;
    pairStatus.mode = -1;
    pairStatus.leakvalAgrees = false;
    pairStatus.fakeAddress = null;
    pairStatus.fakeButterfly = null;
    pairStatus.historyCleared = false;
}

// -----------------------------------------------------------------------------
// Carrier lifecycle and locks.
// -----------------------------------------------------------------------------
let carrier = null;
let carrierView = null;
let carrierWindowBytes = 0;
let carrierAimFn = null;
let carrierRestoreFn = null;
let carrierSetLeakFn = null;
let carrierClearLeakFn = null;
let carrierLeakSlotAddr = 0;
let carrierBrokenReason = null;

let modulePermanentlyBroken = false;
let carrierLockDepth = 0;
let xferScratchInUse = false;
let carrierAdoptionInProgress = false;
let promotionPreflightInProgress = false;
let promotionInProgress = false;
let promotionCallbackInProgress = false;
let promotionExternalCodeInProgress = false;
let promotionUnavailable = false;
let promotionStage = "not-attempted";

function assertOperational(who) {
    if (modulePermanentlyBroken) {
        throw new Error(who + ": the module is in an unrecoverable state"
            + " — module reload required");
    }
}

function assertPublicEntryAllowed(who) {
    assertOperational(who);
    if (promotionCallbackInProgress)
        throw new Error(who + ": cannot be called during a promotion callback");
    if (promotionExternalCodeInProgress)
        throw new Error(who + ": cannot be called during external promotion data handling");
    if (carrierAdoptionInProgress)
        throw new Error(who + ": cannot be called during carrier adoption");
    if (promotionPreflightInProgress)
        throw new Error(who + ": cannot be called during promotion preflight");
}

function assertScalarEntryAllowed(who) {
    assertPublicEntryAllowed(who);
    if (carrierLockDepth > 0)
        throw new Error(who + ": scalar I/O cannot be re-entered during bulk transfer");
}

function trySetPairStatus(key, value) {
    const wasExternalLocked = promotionExternalCodeInProgress;
    promotionExternalCodeInProgress = true;
    try {
        pairStatus[key] = value;
        return true;
    } catch (e) {
        return false;
    } finally {
        promotionExternalCodeInProgress = wasExternalLocked;
    }
}

function setCarrierBroken(why) {
    carrierBrokenReason = why;
    carrierView = null;
    carrierWindowBytes = 0;

    const die = () => {
        throw new Error("mem: carrier is disabled (" + why + ")");
    };

    carrierAimFn = die;
    carrierRestoreFn = die;
    carrierSetLeakFn = die;
    carrierClearLeakFn = die;
    carrierLeakSlotAddr = 0;
    carrier = {
        aim: die,
        restore: die,
        setLeakSlot: die,
        clearLeakSlot: die,
        get view() { return die(); },
        get windowBytes() { return die(); },
        get leakSlotAddress() { return die(); },
        validate: () => false,
        assertHome: () => false,
        profile: null,
        pair: pairStatus
    };
}

function adoptCarrierInternal(c) {
    let reason = "unknown cause";
    try {
        if (modulePermanentlyBroken)
            throw new Error("module is permanently broken");
        if (c === null || typeof c !== "object")
            throw new TypeError("mem: carrier is not an object");

        // Read each externally supplied property once while the caller holds
        // carrierAdoptionInProgress or the internal Promotion lifecycle lock.
        const view = c.view;
        if (!(view instanceof Uint8Array))
            throw new TypeError("mem: carrier view is not a Uint8Array");

        const winBytes = c.windowBytes;
        if (typeof winBytes !== "number" || !Number.isFinite(winBytes)
            || Math.floor(winBytes) !== winBytes || winBytes <= 0) {
            throw new TypeError(
                "mem: carrier windowBytes is not a positive integer"
            );
        }
        if (winBytes > view.length)
            throw new RangeError(
                "mem: carrier windowBytes exceeds view length"
            );

        const aimMethod = c.aim;
        const restoreMethod = c.restore;
        if (typeof aimMethod !== "function")
            throw new TypeError("mem: carrier has no aim()");
        if (typeof restoreMethod !== "function")
            throw new TypeError("mem: carrier has no restore()");

        const setMethod = c.setLeakSlot;
        const clearMethod = c.clearLeakSlot;
        let setLeak = null;
        let clearLeak = null;
        if (typeof setMethod === "function" && typeof clearMethod === "function") {
            setLeak = setMethod.bind(c);
            clearLeak = clearMethod.bind(c);
        }

        const leakAddr = c.leakSlotAddress;
        const aimFn = aimMethod.bind(c);
        const restoreFn = restoreMethod.bind(c);

        // Commit cache only after every required read and bind succeeded.
        carrier = c;
        carrierView = view;
        carrierWindowBytes = winBytes;
        carrierAimFn = aimFn;
        carrierRestoreFn = restoreFn;
        carrierSetLeakFn = setLeak;
        carrierClearLeakFn = clearLeak;
        carrierLeakSlotAddr = leakAddr;
        carrierBrokenReason = null;
        return true;
    } catch (err) {
        reason = safeDescribe(err);
    }

    setCarrierBroken(reason);
    return false;
}

function adoptCarrier(c) {
    assertPublicEntryAllowed("mem.adoptCarrier");
    if (carrierLockDepth > 0)
        throw new Error("mem.adoptCarrier: bulk transfer is active");
    if (promotionInProgress || promotionPreflightInProgress)
        throw new Error("mem.adoptCarrier: promotion is active");
    if (carrierAdoptionInProgress)
        throw new Error("mem.adoptCarrier: another adoption is active");

    carrierAdoptionInProgress = true;
    try {
        return adoptCarrierInternal(c);
    } finally {
        carrierAdoptionInProgress = false;
    }
}

function adoptCarrierForLifecycle(c) {
    if (modulePermanentlyBroken)
        throw new Error("mem: cannot adopt after permanent failure");
    if (carrierAdoptionInProgress)
        throw new Error("mem: nested carrier adoption");
    carrierAdoptionInProgress = true;
    try {
        return adoptCarrierInternal(c);
    } finally {
        carrierAdoptionInProgress = false;
    }
}

// -----------------------------------------------------------------------------
// Address normalisation and 48-bit range checking.
// -----------------------------------------------------------------------------
function toI64(x) {
    if (x instanceof int64)
        return x;
    if (typeof x === "number") {
        if (!Number.isFinite(x) || Math.floor(x) !== x || x < 0)
            throw new TypeError("mem: bad numeric address " + x);
        const hi = Math.floor(x / 0x100000000);
        return new int64(x - hi * 0x100000000, hi);
    }
    if (x !== null && typeof x === "object" && "low" in x)
        return new int64(x.low, ("hi" in x) ? x.hi : x.high);
    throw new TypeError("mem: bad address");
}

function addrNumber(x) {
    if (typeof x === "number") {
        if (Number.isFinite(x) && x >= 0 && Math.floor(x) === x
            && x <= 0xffffffffffff)
            return x;
    }
    const a = toI64(x);
    if (a.hi > 0xffff)
        throw new RangeError("mem: non-canonical address 0x" + a.toString());
    return a.hi * 0x100000000 + a.low;
}

const ADDRESS_SPACE_END = 0x1000000000000;

function checkAddressEnd(base, count, who) {
    if (count > ADDRESS_SPACE_END - base) {
        throw new RangeError(who + ": base=0x" + base.toString(16)
            + " count=" + count
            + " crosses the 48-bit boundary (0x"
            + ADDRESS_SPACE_END.toString(16) + ")");
    }
}

// -----------------------------------------------------------------------------
// Aim storm detection: fixed 1000 ms window, 500000 accepted Aim attempts.
// Date.now is a wall clock, not a monotonic clock; clock changes are handled
// conservatively but cannot provide a true elapsed-time guarantee.
// -----------------------------------------------------------------------------
const AIM_STORM_LIMIT = 500000;
const AIM_STORM_WINDOW_MS = 1000;
let aimCount = 0;
let aimWindowStart = 0;
let aimWindowStarted = false;

function aimFor(addrLike, size) {
    assertPublicEntryAllowed("mem.aim");

    if (!(carrierWindowBytes > 0))
        throw new Error("mem: carrier window is not positive");

    const address = addrNumber(addrLike);
    if (typeof size !== "number" || !Number.isFinite(size)
        || size < 0 || Math.floor(size) !== size) {
        throw new TypeError("mem.aim: invalid size");
    }
    if (size > carrierWindowBytes)
        throw new RangeError("mem: " + size + " exceeds the "
            + carrierWindowBytes + "-byte window");
    checkAddressEnd(address, size, "mem.aim");

    const now = Date.now();
    if (typeof now !== "number" || !Number.isFinite(now))
        throw new Error("mem.aim: Date.now() returned an invalid value");

    if (!aimWindowStarted
        || now < aimWindowStart
        || now - aimWindowStart >= AIM_STORM_WINDOW_MS) {
        aimWindowStart = now;
        aimWindowStarted = true;
        aimCount = 0;
    }

    if (aimCount >= AIM_STORM_LIMIT) {
        throw new Error("mem: aim storm -- over " + AIM_STORM_LIMIT
            + " aims in " + AIM_STORM_WINDOW_MS
            + " ms, refusing to continue");
    }

    // Count immediately before invoking the carrier. If aim throws, the
    // attempt still counts because the carrier invocation was reached.
    aimCount++;
    carrierAimFn(address);
    return address;
}

function valueLow32(value, who) {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || Math.floor(value) !== value)
            throw new TypeError(who + ": non-integer value " + value);
        return value >>> 0;
    }
    if (value instanceof int64)
        return value.low >>> 0;
    if (value !== null && typeof value === "object" && "low" in value)
        return toI64(value).low >>> 0;
    throw new TypeError(who + ": value must be a number or an int64");
}

// -----------------------------------------------------------------------------
// Scalar I/O.
// -----------------------------------------------------------------------------
function read1(addr) {
    assertScalarEntryAllowed("mem.read1");
    aimFor(addr, 1);
    try {
        return carrierView[0];
    } finally {
        carrierRestoreFn();
    }
}

function read2(addr) {
    assertScalarEntryAllowed("mem.read2");
    aimFor(addr, 2);
    try {
        const v = carrierView;
        return v[0] | (v[1] << 8);
    } finally {
        carrierRestoreFn();
    }
}

function read4(addr) {
    assertScalarEntryAllowed("mem.read4");
    aimFor(addr, 4);
    try {
        const v = carrierView;
        return (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
    } finally {
        carrierRestoreFn();
    }
}

function read8(addr) {
    assertScalarEntryAllowed("mem.read8");
    let lo;
    let hi;
    aimFor(addr, 8);
    try {
        const v = carrierView;
        lo = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
        hi = (v[4] | (v[5] << 8) | (v[6] << 16) | (v[7] << 24)) >>> 0;
    } finally {
        carrierRestoreFn();
    }
    return new int64(lo, hi);
}

function write1(addr, value) {
    assertScalarEntryAllowed("mem.write1");
    const v = valueLow32(value, "mem.write1") & 0xff;
    aimFor(addr, 1);
    try {
        carrierView[0] = v;
    } finally {
        carrierRestoreFn();
    }
}

function write2(addr, value) {
    assertScalarEntryAllowed("mem.write2");
    const v = valueLow32(value, "mem.write2") & 0xffff;
    aimFor(addr, 2);
    try {
        const view = carrierView;
        view[0] = v & 0xff;
        view[1] = (v >>> 8) & 0xff;
    } finally {
        carrierRestoreFn();
    }
}

function write4(addr, value) {
    assertScalarEntryAllowed("mem.write4");
    const v = valueLow32(value, "mem.write4");
    aimFor(addr, 4);
    try {
        const view = carrierView;
        view[0] = v & 0xff;
        view[1] = (v >>> 8) & 0xff;
        view[2] = (v >>> 16) & 0xff;
        view[3] = (v >>> 24) & 0xff;
    } finally {
        carrierRestoreFn();
    }
}

function write8(addr, value) {
    assertScalarEntryAllowed("mem.write8");
    let lo;
    let hi;

    if (value instanceof int64) {
        lo = value.low >>> 0;
        hi = value.hi >>> 0;
    } else if (typeof value === "number") {
        if (!Number.isFinite(value) || Math.floor(value) !== value)
            throw new TypeError("mem.write8: non-integer value " + value);
        if (value < 0) {
            if (value < -0x80000000)
                throw new RangeError("mem.write8: value " + value + " below int32 range");
            lo = value >>> 0;
            hi = 0xffffffff;
        } else if (value <= 0xffffffff) {
            lo = value >>> 0;
            hi = 0;
        } else {
            throw new RangeError("mem.write8: " + value + " exceeds 32 bits -- pass an int64");
        }
    } else if (value !== null && typeof value === "object" && "low" in value) {
        const n = toI64(value);
        lo = n.low;
        hi = n.hi;
    } else {
        throw new TypeError("mem.write8: value must be int64 or number");
    }

    aimFor(addr, 8);
    try {
        const view = carrierView;
        view[0] = lo & 0xff;
        view[1] = (lo >>> 8) & 0xff;
        view[2] = (lo >>> 16) & 0xff;
        view[3] = (lo >>> 24) & 0xff;
        view[4] = hi & 0xff;
        view[5] = (hi >>> 8) & 0xff;
        view[6] = (hi >>> 16) & 0xff;
        view[7] = (hi >>> 24) & 0xff;
    } finally {
        carrierRestoreFn();
    }
}

// -----------------------------------------------------------------------------
// leakval. Boolean flags distinguish "no error" from throw null/undefined.
// The primary thrown value is rethrown unchanged; every cleanup failure is
// retained in the private diagnostic store.
// -----------------------------------------------------------------------------
function leakval(obj) {
    assertScalarEntryAllowed("mem.leakval");
    resetLastLeakErrors();

    if (obj === null || (typeof obj !== "object" && typeof obj !== "function"))
        throw new TypeError("mem.leakval: not an object");
    if (carrierSetLeakFn === null || carrierClearLeakFn === null)
        throw new Error("mem.leakval: carrier has no leak slot");

    let lo;
    let hi;
    let primaryErrorSet = false;
    let primaryErrorValue;
    let primaryErrorSource = null;
    let restoreErrorSet = false;
    let restoreErrorValue;
    let clearErrorSet = false;
    let clearErrorValue;

    try {
        carrierSetLeakFn(obj);
    } catch (e) {
        primaryErrorSet = true;
        primaryErrorValue = e;
        primaryErrorSource = "setLeakSlot";
    }

    if (!primaryErrorSet) {
        let aimOk = false;
        try {
            aimFor(carrierLeakSlotAddr, 8);
            aimOk = true;
        } catch (e) {
            primaryErrorSet = true;
            primaryErrorValue = e;
            primaryErrorSource = "aim";
        }

        if (aimOk) {
            try {
                const v = carrierView;
                lo = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
                hi = (v[4] | (v[5] << 8) | (v[6] << 16) | (v[7] << 24)) >>> 0;
            } catch (e) {
                primaryErrorSet = true;
                primaryErrorValue = e;
                primaryErrorSource = "read";
            }

            try {
                carrierRestoreFn();
            } catch (e) {
                restoreErrorSet = true;
                restoreErrorValue = e;
            }
        }
    }

    try {
        carrierClearLeakFn();
    } catch (e) {
        clearErrorSet = true;
        clearErrorValue = e;
    }

    // Internal diagnostic writes cannot be modified through the export.
    if (primaryErrorSet) {
        _lastLeakData.primary.set = true;
        _lastLeakData.primary.source = primaryErrorSource;
        _lastLeakData.primary.value = primaryErrorValue;
    }
    if (restoreErrorSet) {
        _lastLeakData.restore.set = true;
        _lastLeakData.restore.source = "restore";
        _lastLeakData.restore.value = restoreErrorValue;
    }
    if (clearErrorSet) {
        _lastLeakData.clear.set = true;
        _lastLeakData.clear.source = "clearLeakSlot";
        _lastLeakData.clear.value = clearErrorValue;
    }

    if (primaryErrorSet) {
        if ((restoreErrorSet || clearErrorSet)
            && primaryErrorValue !== null
            && (typeof primaryErrorValue === "object"
                || typeof primaryErrorValue === "function")) {
            const parts = [];
            if (restoreErrorSet)
                parts.push("restore: " + safeDescribe(restoreErrorValue));
            if (clearErrorSet)
                parts.push("clearLeakSlot: " + safeDescribe(clearErrorValue));
            try {
                primaryErrorValue.cleanupFailures = parts.join("; ");
            } catch (e) {
                // Frozen or non-extensible primary error; private channel has it.
            }
        }
        throw primaryErrorValue;
    }

    if (restoreErrorSet) {
        if (clearErrorSet
            && restoreErrorValue !== null
            && (typeof restoreErrorValue === "object"
                || typeof restoreErrorValue === "function")) {
            try {
                restoreErrorValue.cleanupFailures =
                    "clearLeakSlot: " + safeDescribe(clearErrorValue);
            } catch (e) {
                // Private channel retains the clear error.
            }
        }
        throw restoreErrorValue;
    }
    if (clearErrorSet)
        throw clearErrorValue;

    if (hi > 0xffff || (lo === 0 && hi === 0) || (lo & 7) !== 0) {
        throw new Error("mem: leakval: implausible cell 0x"
            + new int64(lo, hi).toString());
    }
    return new int64(lo, hi);
}

// -----------------------------------------------------------------------------
// Bulk I/O. Caller objects are touched only outside Aim Window. The carrier
// lock is acquired before reading caller-controlled length/address properties.
// Chunks are not atomic; earlier chunks remain committed after later failure.
// -----------------------------------------------------------------------------
const SCRATCH_SIZE = 0x10000;
const xferScratch = new Uint8Array(SCRATCH_SIZE);

function validateArrayLikeLength(length, who) {
    if (typeof length !== "number"
        || !Number.isFinite(length)
        || length < 0
        || Math.floor(length) !== length
        || length > 0x1fffffffffffff) {
        throw new TypeError(who + ": length is not a valid finite safe integer");
    }
}

function readInto(dest, addr, count) {
    assertPublicEntryAllowed("mem.readInto");

    if (typeof count !== "number" || !Number.isFinite(count)
        || count < 0 || Math.floor(count) !== count
        || count > 0x1fffffffffffff) {
        throw new TypeError("mem.readInto: bad count " + count);
    }
    if (dest === null || typeof dest !== "object")
        throw new TypeError("mem.readInto: dest must be an object");

    // Preserve the existing zero-count short circuit: no length getter,
    // address normalization, carrier access, or Aim is performed.
    if (count === 0)
        return dest;

    if (!(carrierWindowBytes > 0))
        throw new Error("mem.readInto: carrier window is not positive");
    if (xferScratchInUse)
        throw new Error("mem.readInto: reentrant call not supported");

    xferScratchInUse = true;
    carrierLockDepth++;
    try {
        const savedLen = dest.length;
        validateArrayLikeLength(savedLen, "mem.readInto: dest");
        if (count > savedLen)
            throw new RangeError("mem.readInto: count " + count
                + " > dest.length " + savedLen);

        const base = addrNumber(addr);
        checkAddressEnd(base, count, "mem.readInto");

        let done = 0;
        while (done < count) {
            const chunk = Math.min(count - done, carrierWindowBytes, SCRATCH_SIZE);
            if (chunk <= 0)
                throw new Error("mem.readInto: chunk did not advance");

            aimFor(base + done, chunk);
            try {
                for (let i = 0; i < chunk; ++i)
                    xferScratch[i] = carrierView[i];
            } finally {
                carrierRestoreFn();
            }

            // Destination setters/proxy traps execute only after restore.
            for (let i = 0; i < chunk; ++i)
                dest[done + i] = xferScratch[i];

            done += chunk;
        }
    } finally {
        carrierLockDepth--;
        xferScratchInUse = false;
    }
    return dest;
}

function writeInto(addr, src, count) {
    assertPublicEntryAllowed("mem.writeInto");

    if (typeof count !== "number" || !Number.isFinite(count)
        || count < 0 || Math.floor(count) !== count
        || count > 0x1fffffffffffff) {
        throw new TypeError("mem.writeInto: bad count " + count);
    }
    if (src === null || typeof src !== "object")
        throw new TypeError("mem.writeInto: src must be an object");

    if (count === 0)
        return count;

    if (!(carrierWindowBytes > 0))
        throw new Error("mem.writeInto: carrier window is not positive");
    if (xferScratchInUse)
        throw new Error("mem.writeInto: reentrant call not supported");

    xferScratchInUse = true;
    carrierLockDepth++;
    try {
        const savedLen = src.length;
        validateArrayLikeLength(savedLen, "mem.writeInto: src");
        if (count > savedLen)
            throw new RangeError("mem.writeInto: count " + count
                + " > src.length " + savedLen);

        const base = addrNumber(addr);
        checkAddressEnd(base, count, "mem.writeInto");

        let done = 0;
        while (done < count) {
            const chunk = Math.min(count - done, carrierWindowBytes, SCRATCH_SIZE);
            if (chunk <= 0)
                throw new Error("mem.writeInto: chunk did not advance");

            // Source getters/proxy traps execute before Aim.
            for (let i = 0; i < chunk; ++i)
                xferScratch[i] = src[done + i];

            aimFor(base + done, chunk);
            try {
                for (let i = 0; i < chunk; ++i)
                    carrierView[i] = xferScratch[i];
            } finally {
                carrierRestoreFn();
            }
            done += chunk;
        }
    } finally {
        carrierLockDepth--;
        xferScratchInUse = false;
    }
    return count;
}

const READBLOB_DEFAULT_MAX = 0x100000;

function readBlob(addr, size) {
    assertPublicEntryAllowed("mem.readBlob");
    if (typeof size !== "number" || !Number.isFinite(size)
        || Math.floor(size) !== size || size < 0 || size > 0x7fffffff) {
        throw new RangeError("mem.readBlob: bad size " + size);
    }
    if (size > READBLOB_DEFAULT_MAX) {
        throw new RangeError("mem.readBlob: " + size + " exceeds "
            + READBLOB_DEFAULT_MAX
            + " -- use readInto with a preallocated dest");
    }
    const dest = new Uint8Array(size);
    return readInto(dest, addr, size);
}

function writeBlob(addr, bytes) {
    assertPublicEntryAllowed("mem.writeBlob");
    if (!(bytes instanceof Uint8Array))
        throw new TypeError("mem.writeBlob: expected Uint8Array");
    return writeInto(addr, bytes, bytes.length);
}

// -----------------------------------------------------------------------------
// readCString: NUL-terminated Latin-1 byte mapping, capped at 64 KiB.
// -----------------------------------------------------------------------------
const READCSTRING_MAX = 0x10000;
const READCSTRING_CONV_CHUNK = 0x1000;

function readCString(addr, maxLen) {
    assertScalarEntryAllowed("mem.readCString");

    if (maxLen === undefined) {
        maxLen = 0x1000;
    } else if (typeof maxLen !== "number" || !Number.isFinite(maxLen)
        || maxLen <= 0 || Math.floor(maxLen) !== maxLen) {
        throw new TypeError("mem.readCString: bad maxLen " + maxLen);
    }
    if (maxLen > READCSTRING_MAX) {
        throw new RangeError("mem.readCString: maxLen " + maxLen
            + " exceeds " + READCSTRING_MAX
            + " -- use readBlob/readInto with a preallocated dest");
    }

    const base = addrNumber(addr);
    checkAddressEnd(base, maxLen, "mem.readCString");

    if (!(carrierWindowBytes > 0))
        throw new Error("mem.readCString: carrier window is not positive");

    const buf = new Uint8Array(maxLen);
    let nul = -1;
    let done = 0;

    while (done < maxLen) {
        const chunk = Math.min(maxLen - done, carrierWindowBytes);
        if (chunk <= 0)
            throw new Error("mem.readCString: chunk did not advance");

        aimFor(base + done, chunk);
        let found = false;
        try {
            const view = carrierView;
            for (let i = 0; i < chunk; ++i) {
                const b = view[i];
                buf[done + i] = b;
                if (b === 0) {
                    nul = done + i;
                    found = true;
                    break;
                }
            }
        } finally {
            carrierRestoreFn();
        }

        if (found)
            break;
        done += chunk;
    }

    const end = (nul < 0) ? maxLen : nul;
    if (end === 0)
        return "";

    const parts = [];
    for (let i = 0; i < end; i += READCSTRING_CONV_CHUNK) {
        const stop = Math.min(i + READCSTRING_CONV_CHUNK, end);
        const codes = new Array(stop - i);
        for (let j = i; j < stop; ++j)
            codes[j - i] = buf[j];
        parts.push(String.fromCharCode.apply(null, codes));
    }
    return parts.join("");
}

// -----------------------------------------------------------------------------
// Pair carrier support.
// -----------------------------------------------------------------------------
function u32At(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function low48At(bytes, offset) {
    return bytes[offset]
        + bytes[offset + 1] * 0x100
        + bytes[offset + 2] * 0x10000
        + bytes[offset + 3] * 0x1000000
        + bytes[offset + 4] * 0x100000000
        + bytes[offset + 5] * 0x10000000000;
}

function canonical48(bytes, offset) {
    return bytes[offset + 6] === 0 && bytes[offset + 7] === 0;
}

function sameBytes(left, right, count) {
    for (let i = 0; i < count; ++i) {
        if (left[i] !== right[i])
            return false;
    }
    return true;
}

function hexOf(bytes, count) {
    let out = "";
    for (let i = 0; i < count; ++i)
        out += (bytes[i] & 0xff).toString(16).padStart(2, "0");
    return out;
}

const WORKER_BUFFER_SIZE = 0x100;
const PAIR_IDENT_OFFSET = 0x20;
const MAIN_IDENT_OFFSET = 0x40;
const PAIR_HEADER_BYTES = 0x20;
const HOME_BYTE = 0x3c;
const WORKER_LENGTH_MAX = 0xffffffff;

const pairScratch = new ArrayBuffer(8);
const pairScratchBytes = new Uint8Array(pairScratch);
const pairScratchWords = new Uint32Array(pairScratch);

const mainMagic = new Uint8Array([0x63, 0x9e, 0x1f, 0x29, 0xd2, 0x84, 0x0b, 0x5c]);
const workerMagic = new Uint8Array([0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a, 0x7c, 0x15]);

const workerHeader = new Uint8Array(PAIR_HEADER_BYTES);
const identityBytes = new Uint8Array(8);
const workerOriginalVector = new Uint8Array(8);
const workerOriginalLength = new Uint8Array(4);

let mainView = null;
let workerBuffer = null;
let workerView = null;
let workerMirror = null;
let pairVectorOffset = -1;
const retained = [];

function pairAim(address) {
    if (mainView === null || pairVectorOffset < 0)
        throw new Error("mem.pair.aim: pair vector is not initialised");
    const high = Math.floor(address / 0x100000000);
    pairScratchWords[0] = address - high * 0x100000000;
    pairScratchWords[1] = high;
    const mv = mainView;
    const off = pairVectorOffset;
    for (let i = 0; i < 8; ++i)
        mv[off + i] = pairScratchBytes[i];
}

function pairRestore() {
    if (mainView === null || pairVectorOffset < 0)
        throw new Error("mem.pair.restore: pair vector is not initialised");
    const mv = mainView;
    const off = pairVectorOffset;
    for (let i = 0; i < 8; ++i)
        mv[off + i] = workerOriginalVector[i];
}

function buildPairCarrier(fake, snapshot) {
    // All caller-visible carrier properties were snapshotted under the
    // preflight lock. The builder does not re-read external getters.
    const validateMethod = snapshot.validate;
    const setMethod = snapshot.setLeakSlot;
    const clearMethod = snapshot.clearLeakSlot;
    const validate = (a) => validateMethod.call(fake, a);
    const setLeakSlot = (typeof setMethod === "function")
        ? (o) => setMethod.call(fake, o) : null;
    const clearLeakSlot = (typeof clearMethod === "function")
        ? () => clearMethod.call(fake) : null;

    const widened = (workerView !== null)
        ? workerView.length : WORKER_BUFFER_SIZE;

    return {
        aim(address) {
            if (mainView === null || workerView === null || pairVectorOffset < 0)
                throw new Error("mem.pair.aim: the pair has been dropped");
            if (!validate(address))
                throw new RangeError("mem.pair.aim: implausible address " + address);
            pairAim(address);
        },
        restore() {
            if (mainView === null || pairVectorOffset < 0)
                throw new Error("mem.pair.restore: the pair has been dropped");
            pairRestore();
        },
        get view() { return workerView; },
        windowBytes: widened,

        holder: snapshot.holder,
        holderAddress: snapshot.holderAddress,
        leakSlotOffset: snapshot.leakSlotOffset,
        leakSlotAddress: snapshot.leakSlotAddress,
        setLeakSlot: setLeakSlot,
        clearLeakSlot: clearLeakSlot,
        anchorObject: snapshot.anchorObject,
        anchorObjectAddress: snapshot.anchorObjectAddress,
        textarea: snapshot.textarea,
        textareaAddress: snapshot.textareaAddress,

        profile: snapshot.profile,
        attempts: snapshot.attempts,
        validate: validate,
        hostAddress: snapshot.hostAddress,
        fakeAddress: snapshot.fakeAddress,
        pair: pairStatus,

        assertHome() {
            if (workerView === null || workerMirror === null)
                return false;
            return workerView[0] === HOME_BYTE && workerMirror[0] === HOME_BYTE;
        }
    };
}

function proveMagic(note, who, slot, at, expected, context) {
    const target = toI64(at);
    const record = {
        at: target,
        expected: hexOf(expected, 8),
        found: null,
        pass: false
    };
    pairStatus[slot] = record;
    readInto(identityBytes, at, 8);
    record.found = hexOf(identityBytes, 8);
    record.pass = sameBytes(identityBytes, expected, 8);
    note("PAIR-IDENTITY-" + who.toUpperCase(),
        "at=0x" + target.toString() + "-found=" + record.found
        + "-expected=" + record.expected + "-pass=" + record.pass
        + "-" + context);
    if (!record.pass) {
        throw new Error("mem.promote: " + who + " identity failed -- read "
            + record.found + " at 0x" + target.toString()
            + ", expected " + record.expected + " (" + context + ")");
    }
    return record;
}

// -----------------------------------------------------------------------------
// Promotion. Preflight is protected separately from the main Promotion body.
// releaseStarted is the sole authority for whether rollback is forbidden.
// -----------------------------------------------------------------------------
export function promoteToRealPair(onEvent) {
    assertPublicEntryAllowed("mem.promote");

    if (carrierLockDepth > 0)
        throw new Error("mem.promote: cannot start promotion during bulk I/O");
    if (carrierAdoptionInProgress)
        throw new Error("mem.promote: carrier adoption is active");
    if (promotionPreflightInProgress || promotionInProgress)
        throw new Error("mem.promote: promotion is already active");
    if (promotionUnavailable)
        throw new Error("mem.promote: Pair promotion is unavailable after reset failure");

    // Preflight lock: external getters or carrier validation methods cannot
    // re-enter I/O, adoption, installation, or another Promotion while these
    // caller-visible properties are being read.
    let fake;
    let profile;
    let VECTOR_OFF;
    let LENGTH_OFF;
    let MODE_OFF;
    let BUTTERFLY_OFF;
    let hostAddr;
    let fakeAddr;
    let fakeWindowBytes;
    let fakeValidateMethod;
    let fakeAssertHomeMethod;
    let fakeRestoreMethod;
    let fakeView;
    let fakeSnapshot;

    promotionPreflightInProgress = true;
    try {
        // pairStatus is caller-visible and its properties may have been
        // redefined. Read them only while preflight blocks reentrant APIs.
        if (pairStatus.promoted)
            throw new Error("mem.promote: already promoted");
        if (pairStatus.state === "broken")
            throw new Error("mem.promote: carrier state is broken — module reload required");

        fake = carrier;
        if (fake === null || typeof fake !== "object")
            throw new TypeError("mem.promote: no carrier");

        const fakeAimMethod = fake.aim;
        const fakeRestoreMethod = fake.restore;
        if (typeof fakeAimMethod !== "function"
            || typeof fakeRestoreMethod !== "function") {
            throw new TypeError("mem.promote: carrier aim/restore methods are invalid");
        }

        if (fakeCellReleased())
            throw new Error("mem.promote: core.js already released the fake cell");

        profile = fake.profile;
        if (!profile || typeof profile !== "object")
            throw new TypeError("mem.promote: carrier has no layout profile");

        // Snapshot each profile field once.
        VECTOR_OFF = profile.vectorOffset;
        BUTTERFLY_OFF = profile.butterflyOffset;
        const INLINE_SLOT_OFF = profile.inlineSlotOffset;
        if (typeof VECTOR_OFF !== "number"
            || typeof BUTTERFLY_OFF !== "number"
            || typeof INLINE_SLOT_OFF !== "number") {
            throw new TypeError("mem.promote: carrier layout profile is incomplete");
        }
        LENGTH_OFF = VECTOR_OFF + 8;
        MODE_OFF = LENGTH_OFF + 4;

        const hostLike = fake.hostAddress;
        const fakeLike = fake.fakeAddress;
        hostAddr = addrNumber(hostLike);
        fakeAddr = addrNumber(fakeLike);

        fakeValidateMethod = fake.validate;
        fakeAssertHomeMethod = fake.assertHome;
        fakeRestoreMethod = fake.restore;
        if (typeof fakeValidateMethod !== "function"
            || typeof fakeAssertHomeMethod !== "function"
            || typeof fakeRestoreMethod !== "function") {
            throw new TypeError("mem.promote: carrier validation/restore methods are invalid");
        }

        if (!fakeValidateMethod.call(fake, hostAddr)
            || !fakeValidateMethod.call(fake, fakeAddr)
            || fakeAddr - hostAddr !== INLINE_SLOT_OFF) {
            throw new TypeError("mem.promote: the fake cell's address is unusable"
                + " (host=" + hostAddr + " fake=" + fakeAddr + ")");
        }

        fakeWindowBytes = fake.windowBytes;
        if (typeof fakeWindowBytes !== "number"
            || !Number.isFinite(fakeWindowBytes)
            || Math.floor(fakeWindowBytes) !== fakeWindowBytes
            || fakeWindowBytes <= 0) {
            throw new TypeError("mem.promote: fake carrier window is invalid");
        }

        // Snapshot all remaining carrier data properties under the preflight
        // lock. No later Promotion step needs to invoke these getters again.
        fakeSnapshot = {
            validate: fakeValidateMethod,
            assertHome: fakeAssertHomeMethod,
            restore: fakeRestoreMethod,
            setLeakSlot: fake.setLeakSlot,
            clearLeakSlot: fake.clearLeakSlot,
            holder: fake.holder,
            holderAddress: fake.holderAddress,
            leakSlotOffset: fake.leakSlotOffset,
            leakSlotAddress: fake.leakSlotAddress,
            anchorObject: fake.anchorObject,
            anchorObjectAddress: fake.anchorObjectAddress,
            textarea: fake.textarea,
            textareaAddress: fake.textareaAddress,
            profile: profile,
            attempts: fake.attempts,
            hostAddress: hostLike,
            fakeAddress: fakeLike
        };

        // Snapshot the initial view before the final state-reset step.
        fakeView = fake.view;

        // Reset is the last state-changing preflight operation.
        try {
            resetPairStatus();
        } catch (resetErr) {
            promotionUnavailable = true;
            try {
                pairStatus.state = "promotion-unavailable";
                pairStatus.stage = "PAIR-RESET-FAIL";
                pairStatus.failedAt = "PAIR-RESET-FAIL";
                pairStatus.error = "pairStatus reset failed: " + safeDescribe(resetErr);
            } catch (diagnosticErr) {
                // Preserve and rethrow resetErr.
            }
            throw resetErr;
        }

        retained.length = 0;
        resetInternalReleaseLog();
        promotionStage = "not-attempted";
    } finally {
        promotionPreflightInProgress = false;
    }

    // No caller code runs between releasing preflight and acquiring the main
    // Promotion lock; JavaScript execution here is synchronous.
    promotionInProgress = true;

    const note = (tag, detail) => {
        promotionStage = tag;
        trySetPairStatus("stage", tag);
        if (typeof onEvent === "function") {
            promotionCallbackInProgress = true;
            try {
                onEvent(tag, detail === undefined ? "" : String(detail));
            } catch (callbackErr) {
                // Diagnostics are intentionally non-fatal.
            } finally {
                promotionCallbackInProgress = false;
            }
        }
    };

    const fakeValidate = (address) => fakeValidateMethod.call(fake, address);
    const fakeAssertHome = () => fakeAssertHomeMethod.call(fake);

    let releaseStarted = false;
    let releaseReturned = false;
    let releaseVerified = false;
    let releaseRecordStored = false;
    let committed = false;

    try {
        note("PAIR-BEGIN", "window=" + fakeWindowBytes
            + "-vector=+" + VECTOR_OFF
            + "-length=+" + LENGTH_OFF
            + "-mode=+" + MODE_OFF);

        const mainRecord = carrierHeaderCopy();
        const mainHomeVector = carrierHomeVector();
        if (!(mainRecord instanceof Uint8Array)
            || mainRecord.length < PAIR_HEADER_BYTES) {
            throw new Error("mem.promote: core.js's carrier record is the wrong shape");
        }

        const recordVector = low48At(mainRecord, VECTOR_OFF);
        pairStatus.mainVector = toI64(mainHomeVector);
        pairStatus.mainRecordVector = toI64(recordVector);
        pairStatus.mainWindow = u32At(mainRecord, LENGTH_OFF);
        pairStatus.structureID = u32At(mainRecord, 0);
        note("PAIR-MAIN-RECORD", "home=0x" + pairStatus.mainVector.toString()
            + "-record=0x" + pairStatus.mainRecordVector.toString()
            + "-len=" + pairStatus.mainWindow
            + "-mode=" + mainRecord[MODE_OFF]
            + "-sid=0x" + (pairStatus.structureID >>> 0).toString(16));

        if (recordVector !== mainHomeVector) {
            throw new Error("mem.promote: profile.vectorOffset disagrees with the recorded home vector");
        }
        if (!fakeValidate(mainHomeVector) || mainHomeVector % 8 !== 0) {
            throw new Error("mem.promote: the recorded home vector is implausible"
                + " (0x" + pairStatus.mainVector.toString() + ")");
        }
        if (pairStatus.mainWindow !== fakeWindowBytes) {
            throw new Error("mem.promote: record m_length (" + pairStatus.mainWindow
                + ") is not the carrier window (" + fakeWindowBytes + ")");
        }

        mainView = fakeView;
        retained.push(mainView);
        if (!(mainView instanceof Uint8Array)
            || mainView.length !== fakeWindowBytes
            || MAIN_IDENT_OFFSET + 8 > fakeWindowBytes) {
            throw new Error("mem.promote: the carrier view is not what core.js described");
        }

        pairStatus.fakeAddress = toI64(fakeAddr);
        pairStatus.fakeButterfly = read8(fakeAddr + BUTTERFLY_OFF);
        note("PAIR-FAKE-BUTTERFLY", "host=0x" + hostAddr.toString(16)
            + "-fake=0x" + pairStatus.fakeAddress.toString()
            + "-butterfly=0x" + pairStatus.fakeButterfly.toString());

        workerBuffer = new ArrayBuffer(WORKER_BUFFER_SIZE);
        workerView = new Uint8Array(workerBuffer);
        workerMirror = new Uint8Array(workerBuffer);
        retained.push(workerBuffer, workerView, workerMirror);
        workerMirror[0] = HOME_BYTE;
        for (let i = 0; i < 8; ++i)
            workerMirror[PAIR_IDENT_OFFSET + i] = workerMagic[i];

        if (workerView[0] !== HOME_BYTE)
            throw new Error("mem.promote: workerView does not alias workerMirror");

        for (let i = 0; i < 8; ++i)
            mainView[MAIN_IDENT_OFFSET + i] = mainMagic[i];
        for (let i = 0; i < 8; ++i) {
            if (mainView[MAIN_IDENT_OFFSET + i] !== mainMagic[i])
                throw new Error("mem.promote: main magic did not read back through its JS view");
        }

        const mainAddr = addrNumber(leakval(mainView));
        const workerAddr = addrNumber(leakval(workerView));
        pairStatus.mainAddress = toI64(mainAddr);
        pairStatus.workerAddress = toI64(workerAddr);
        note("PAIR-CELLS", "main=0x" + pairStatus.mainAddress.toString()
            + "-worker=0x" + pairStatus.workerAddress.toString());

        if (mainAddr === workerAddr)
            throw new Error("mem.promote: main and worker leaked the same cell");
        if (mainAddr % 0x10 !== 0 || workerAddr % 0x10 !== 0)
            throw new Error("mem.promote: a leaked cell is not atom-aligned");

        const fromFakeSlot = read8(fakeAddr + VECTOR_OFF);
        pairStatus.mainCellFromFakeSlot = fromFakeSlot;
        note("PAIR-MAIN-CELL", "fake-m_vector=0x" + fromFakeSlot.toString()
            + "-leakval=0x" + pairStatus.mainAddress.toString()
            + "-at=0x" + (fakeAddr + VECTOR_OFF).toString(16));

        if (fromFakeSlot.low !== pairStatus.mainAddress.low
            || fromFakeSlot.hi !== pairStatus.mainAddress.hi) {
            throw new Error("mem.promote: main CELL identity failed");
        }

        proveMagic(note, "main", "mainIdentity",
            mainHomeVector + MAIN_IDENT_OFFSET,
            mainMagic,
            "home=0x" + pairStatus.mainVector.toString()
                + "-cell=0x" + pairStatus.mainAddress.toString()
                + "-offset=+0x" + MAIN_IDENT_OFFSET.toString(16));

        readInto(workerHeader, workerAddr, PAIR_HEADER_BYTES);
        const workerVector = low48At(workerHeader, VECTOR_OFF);
        const workerButterfly = low48At(workerHeader, BUTTERFLY_OFF);
        pairStatus.mode = workerHeader[MODE_OFF];
        pairStatus.workerWindow = u32At(workerHeader, LENGTH_OFF);
        pairStatus.workerVector = toI64(workerVector);
        pairStatus.workerButterfly = toI64(workerButterfly);
        note("PAIR-WORKER-HEADER", "sid=0x" + u32At(workerHeader, 0).toString(16)
            + "-vector=0x" + pairStatus.workerVector.toString()
            + "-len=" + pairStatus.workerWindow
            + "-mode=" + pairStatus.mode
            + "-butterfly=0x" + pairStatus.workerButterfly.toString());

        const gate =
            u32At(workerHeader, 0) === pairStatus.structureID
            && (workerHeader[7] === 0 || workerHeader[7] === 1)
            && pairStatus.workerWindow === WORKER_BUFFER_SIZE
            && workerHeader[MODE_OFF] === mainRecord[MODE_OFF]
            && workerHeader[MODE_OFF + 1] === 0
            && workerHeader[MODE_OFF + 2] === 0
            && workerHeader[MODE_OFF + 3] === 0
            && canonical48(workerHeader, BUTTERFLY_OFF)
            && workerButterfly > 0x100000000
            && workerButterfly % 8 === 0
            && canonical48(workerHeader, VECTOR_OFF)
            && fakeValidate(workerVector)
            && workerVector % 8 === 0
            && workerVector !== mainHomeVector;

        if (!gate) {
            throw new Error("mem.promote: header gate failed"
                + " worker-len=" + pairStatus.workerWindow
                + " worker-mode=" + workerHeader[MODE_OFF]
                + " main-mode=" + mainRecord[MODE_OFF]
                + " worker-sid=" + u32At(workerHeader, 0)
                + " main-sid=" + pairStatus.structureID
                + " worker-vector=0x" + pairStatus.workerVector.toString()
                + " worker-butterfly=0x" + pairStatus.workerButterfly.toString()
                + " main-home=0x" + pairStatus.mainVector.toString());
        }

        proveMagic(note, "worker", "workerIdentity",
            workerVector + PAIR_IDENT_OFFSET,
            workerMagic,
            "vector=0x" + pairStatus.workerVector.toString()
                + "-cell=0x" + pairStatus.workerAddress.toString()
                + "-offset=+0x" + PAIR_IDENT_OFFSET.toString(16));
        note("PAIR-IDENTITY", "main-cell=proved-main-buffer=proved-worker=proved");

        for (let i = 0; i < 8; ++i)
            workerOriginalVector[i] = workerHeader[VECTOR_OFF + i];
        for (let i = 0; i < 4; ++i)
            workerOriginalLength[i] = workerHeader[LENGTH_OFF + i];

        note("PAIR-COMMIT", "main=0x" + pairStatus.mainAddress.toString()
            + "-worker=0x" + pairStatus.workerAddress.toString()
            + "-next=aim-without-restore");
        aimFor(workerAddr, PAIR_HEADER_BYTES);
        committed = true;
        pairStatus.committed = true;

        for (let i = 0; i < 4; ++i)
            mainView[LENGTH_OFF + i] = 0xff;
        pairStatus.workerLength = workerView.length;

        if (pairStatus.workerLength !== WORKER_LENGTH_MAX)
            throw new Error("mem.promote: m_length write did not land");
        if (workerMirror.length !== WORKER_BUFFER_SIZE)
            throw new Error("mem.promote: mirror was widened too");
        if (workerView[0] !== HOME_BYTE)
            throw new Error("mem.promote: worker no longer sees its own buffer");
        if (mainView[MODE_OFF] !== workerHeader[MODE_OFF]
            || mainView[MODE_OFF + 1] !== 0
            || mainView[MODE_OFF + 2] !== 0
            || mainView[MODE_OFF + 3] !== 0) {
            throw new Error("mem.promote: m_mode was disturbed by the widening");
        }
        for (let i = 0; i < 8; ++i) {
            if (mainView[VECTOR_OFF + i] !== workerOriginalVector[i])
                throw new Error("mem.promote: worker m_vector moved during widening");
        }
        note("PAIR-WIDENED", "length=0x" + WORKER_LENGTH_MAX.toString(16)
            + "-mode=0x" + pairStatus.mode.toString(16));

        pairVectorOffset = VECTOR_OFF;
        const pairCarrier = buildPairCarrier(fake, fakeSnapshot);
        if (!adoptCarrierForLifecycle(pairCarrier)) {
            throw new Error("mem.promote: pair carrier adoption failed ("
                + (carrierBrokenReason || "unknown") + ")");
        }

        readInto(identityBytes, workerVector + PAIR_IDENT_OFFSET, 8);
        if (!sameBytes(identityBytes, workerMagic, 8)) {
            throw new Error("mem.promote: read through pair returned "
                + hexOf(identityBytes, 8) + ", expected " + hexOf(workerMagic, 8));
        }

        write8(workerVector + PAIR_IDENT_OFFSET,
            new int64(0x0d0c0b0a, 0x04030201));
        const back = [0x0a, 0x0b, 0x0c, 0x0d, 0x01, 0x02, 0x03, 0x04];
        for (let i = 0; i < 8; ++i) {
            if (workerMirror[PAIR_IDENT_OFFSET + i] !== back[i])
                throw new Error("mem.promote: pair write failed at byte " + i);
        }
        for (let i = 0; i < 8; ++i)
            workerMirror[PAIR_IDENT_OFFSET + i] = workerMagic[i];

        const workerAgain = addrNumber(leakval(workerView));
        pairStatus.leakvalAgrees = workerAgain === workerAddr;
        if (!pairStatus.leakvalAgrees) {
            throw new Error("mem.promote: leakval through pair disagrees (0x"
                + toI64(workerAgain).toString() + " vs 0x"
                + pairStatus.workerAddress.toString() + ")");
        }

        const mv = read8(mainAddr + VECTOR_OFF);
        if (mv.low !== pairStatus.workerAddress.low
            || mv.hi !== pairStatus.workerAddress.hi) {
            throw new Error("mem.promote: main.m_vector does not point to worker cell");
        }
        if (read4(mainAddr + LENGTH_OFF) !== fakeWindowBytes)
            throw new Error("mem.promote: main m_length was disturbed");
        note("PAIR-REPROVED", "main-m_vector=0x" + mv.toString()
            + "-leakval=0x" + toI64(workerAgain).toString());

        // Last caller callback before the final array validation and Release.
        note("PAIR-RELEASE", "next=release-fake-cell-and-debris");

        let finalCheckErr;
        promotionExternalCodeInProgress = true;
        try {
            const finalArray = getReleasedArrayReference();
            finalCheckErr = validateReleasedArray(finalArray);
        } finally {
            promotionExternalCodeInProgress = false;
        }
        if (finalCheckErr !== null)
            throw new Error("mem.promote: pairStatus.released failed final check: "
                + finalCheckErr);

        // No caller-controlled code between this flag and the release call.
        releaseStarted = true;
        const rel = releaseFakeCell();
        releaseReturned = true;
        internalReleaseLog.returned = true;

        // Snapshot the returned record immediately, before verification calls.
        let snapshotErrorSet = false;
        let snapshotErrorValue;
        promotionExternalCodeInProgress = true;
        try {
            try {
                if (rel === null || typeof rel !== "object")
                    throw new TypeError("releaseFakeCell() did not return an object");

                const relReleased = rel.released;
                if (!Array.isArray(relReleased))
                    throw new TypeError("releaseFakeCell().released is not an Array");

                copyArrayIndexProperties(
                    relReleased,
                    internalReleaseLog.released,
                    "mem.release.snapshot"
                );
                const historyCleared = rel.historyCleared;
                internalReleaseLog.historyCleared = !!historyCleared;
                internalReleaseLog.recorded = true;
            } catch (snapErr) {
                snapshotErrorSet = true;
                snapshotErrorValue = snapErr;
                internalReleaseLog.snapshotErrorSet = true;
                internalReleaseLog.snapshotError = snapErr;
                internalReleaseLog.recorded = false;
            }
        } finally {
            promotionExternalCodeInProgress = false;
        }

        if (!fakeCellReleased())
            throw new Error("mem.promote: core.js did not release the fake cell");
        if (fakeAssertHome() !== false)
            throw new Error("mem.promote: core.js carrier still reports itself live");

        releaseVerified = true;
        internalReleaseLog.verified = true;

        if (!internalReleaseLog.recorded) {
            throw new Error("mem.promote: release returned but its record is invalid: "
                + (snapshotErrorSet
                    ? safeDescribe(snapshotErrorValue)
                    : "record was not stored"));
        }

        // Update the public record from the private snapshot, preserving the
        // exported Array identity and bypassing inherited numeric setters.
        let recordErrorSet = false;
        let recordErrorValue;
        promotionExternalCodeInProgress = true;
        try {
            try {
                const publicArray = getReleasedArrayReference();
                const publicArrayErr = validateReleasedArray(publicArray);
                if (publicArrayErr !== null)
                    throw new Error(publicArrayErr);

                copyArrayIndexProperties(
                    internalReleaseLog.released,
                    publicArray,
                    "mem.release.public-record"
                );
                pairStatus.historyCleared = internalReleaseLog.historyCleared;
            } catch (recordErr) {
                recordErrorSet = true;
                recordErrorValue = recordErr;
            }
        } finally {
            promotionExternalCodeInProgress = false;
        }

        if (recordErrorSet) {
            throw new Error("mem.promote: STATE INTEGRITY FAILURE — release was "
                + "verified, but pairStatus.released could not be updated: "
                + safeDescribe(recordErrorValue)
                + " (private record is available through getInternalReleaseLog())");
        }

        releaseRecordStored = true;
        internalReleaseLog.publicRecordStored = true;

        if (!releaseStarted || !releaseReturned || !releaseVerified
            || !internalReleaseLog.recorded || !releaseRecordStored) {
            throw new Error("mem.promote: release completion conditions were not all satisfied");
        }

        pairStatus.promoted = true;
        pairStatus.state = "pair";
        pairStatus.error = null;
        note("PAIR-UP", "main=0x" + pairStatus.mainAddress.toString()
            + "-worker=0x" + pairStatus.workerAddress.toString()
            + "-home=0x" + pairStatus.mainVector.toString()
            + "-mode=0x" + pairStatus.mode.toString(16)
            + "-sid=0x" + pairStatus.structureID.toString(16)
            + "-released=" + pairStatus.released.length
            + "-history-cleared=" + pairStatus.historyCleared);
        return pairStatus;

    } catch (error) {
        // Once releaseStarted is true, the resource may have been partially or
        // fully released. No rollback is permitted, regardless of thrown value.
        // Set the private lock BEFORE touching caller-visible pairStatus.
        if (releaseStarted) {
            // Lock permanently before inspecting an arbitrary thrown value;
            // its message/name/toString accessors may execute caller code.
            modulePermanentlyBroken = true;
            let detail;
            promotionExternalCodeInProgress = true;
            try {
                detail = errorSummary(error);
            } finally {
                promotionExternalCodeInProgress = false;
            }
            const reason = "post-release failure: " + detail;
            setCarrierBroken(reason);

            trySetPairStatus("promoted", false);
            trySetPairStatus("fallback", false);
            trySetPairStatus("state", "broken");
            trySetPairStatus("failedAt", promotionStage);
            trySetPairStatus("error", reason);

            pairVectorOffset = -1;
            workerView = null;
            workerMirror = null;
            workerBuffer = null;
            mainView = null;
            trySetPairStatus("mainViewFreed", true);
            trySetPairStatus("workerMirrorFreed", true);
            retained.length = 0;

            try {
                globalThis.p = undefined;
            } catch (withdrawErr) {
                // The private permanent lock still disables exported functions.
            }
            throw error;
        }

        // Pre-release failure: rollback remains permitted. Perform restoration
        // using private locals BEFORE attempting any diagnostic writes to the
        // caller-visible pairStatus object, which may have been frozen or
        // reconfigured by onEvent.
        let detail;
        promotionExternalCodeInProgress = true;
        try {
            detail = errorSummary(error);
        } finally {
            promotionExternalCodeInProgress = false;
        }
        let clean = true;
        let mainAtHome = null;

        if (committed) {
            try {
                for (let i = 0; i < 8; ++i)
                    mainView[VECTOR_OFF + i] = workerOriginalVector[i];
                for (let i = 0; i < 4; ++i)
                    mainView[LENGTH_OFF + i] = workerOriginalLength[i];
            } catch (rollbackWriteErr) {
                clean = false;
            }
            try {
                fakeRestoreMethod.call(fake);
            } catch (rollbackRestoreErr) {
                clean = false;
            }

            try {
                if (!(workerView.length === WORKER_BUFFER_SIZE
                    && workerMirror.length === WORKER_BUFFER_SIZE
                    && workerView[0] === HOME_BYTE
                    && fakeAssertHome() === true)) {
                    clean = false;
                }
            } catch (rollbackVerifyErr) {
                clean = false;
            }
        }

        try {
            mainAtHome = fakeAssertHome();
        } catch (homeErr) {
            mainAtHome = null;
        }

        let finalState = (committed && !clean) ? "broken" : "fake";

        pairVectorOffset = -1;
        workerView = null;
        workerMirror = null;
        workerBuffer = null;
        mainView = null;
        retained.length = 0;

        if (finalState === "broken") {
            modulePermanentlyBroken = true;
            setCarrierBroken(detail || "rollback did not verify");
        } else {
            if (!adoptCarrierForLifecycle(fake)) {
                modulePermanentlyBroken = true;
                finalState = "broken";
                setCarrierBroken("carrier adoption failed during rollback: "
                    + (carrierBrokenReason || "unknown"));
            }
        }

        // Diagnostics are best-effort. They must never prevent rollback,
        // re-adoption, or activation of the permanent fail-closed lock.
        let diagnosticsWritable = true;
        if (!trySetPairStatus("failedAt", promotionStage))
            diagnosticsWritable = false;
        if (!trySetPairStatus("error", detail))
            diagnosticsWritable = false;
        if (!trySetPairStatus("rolledBack", committed))
            diagnosticsWritable = false;
        if (!trySetPairStatus("rollbackClean", committed ? clean : null))
            diagnosticsWritable = false;
        if (!trySetPairStatus("mainAtHome", mainAtHome))
            diagnosticsWritable = false;
        if (!trySetPairStatus("promoted", false))
            diagnosticsWritable = false;
        if (!trySetPairStatus("fallback", finalState !== "broken"))
            diagnosticsWritable = false;
        if (!trySetPairStatus("state", finalState))
            diagnosticsWritable = false;
        if (committed && !trySetPairStatus("committed", true))
            diagnosticsWritable = false;
        if (!trySetPairStatus("mainViewFreed", true))
            diagnosticsWritable = false;
        if (!trySetPairStatus("workerMirrorFreed", true))
            diagnosticsWritable = false;

        // If pairStatus itself was frozen or corrupted, ordinary I/O can
        // remain available after a verified rollback, but future Pair
        // promotion is disabled because its diagnostics cannot be reset.
        if (!diagnosticsWritable && finalState !== "broken")
            promotionUnavailable = true;

        note("PAIR-FALLBACK", "state=" + finalState
            + "-committed=" + committed
            + "-rollback-clean=" + (committed ? clean : null)
            + "-main-at-home=" + mainAtHome
            + "-at=" + promotionStage + "-" + detail);
        throw error;
    } finally {
        promotionInProgress = false;
    }
}

// -----------------------------------------------------------------------------
// Public installation entry point.
// -----------------------------------------------------------------------------
export function installWindowP(c, options) {
    assertPublicEntryAllowed("mem.installWindowP");

    if (carrierLockDepth > 0)
        throw new Error("mem.installWindowP: bulk transfer is active");
    if (promotionInProgress || promotionPreflightInProgress)
        throw new Error("mem.installWindowP: promotion is active");
    if (carrierAdoptionInProgress)
        throw new Error("mem.installWindowP: carrier adoption is active");
    if (promotionUnavailable)
        throw new Error("mem.installWindowP: Pair promotion is unavailable");

    carrierAdoptionInProgress = true;
    let adopted = false;
    try {
        adopted = adoptCarrierInternal(c);
    } finally {
        carrierAdoptionInProgress = false;
    }

    if (!adopted) {
        throw new Error("mem.installWindowP: carrier adoption failed ("
            + (carrierBrokenReason || "unknown") + ")");
    }

    // Read options once under a lifecycle lock; option getters are external.
    let promoteOption;
    let onEventOption;
    carrierAdoptionInProgress = true;
    try {
        const opts = options || {};
        promoteOption = opts.promote;
        onEventOption = opts.onEvent;
    } finally {
        carrierAdoptionInProgress = false;
    }

    const prim = {
        read1: read1,
        read2: read2,
        read4: read4,
        read8: read8,
        write1: write1,
        write2: write2,
        write4: write4,
        write8: write8,
        leakval: leakval,
        readInto: readInto,
        writeInto: writeInto,
        readBlob: readBlob,
        writeBlob: writeBlob,
        readCString: readCString
    };
    globalThis.p = prim;

    if (promoteOption === false) {
        pairStatus.state = "disabled";
        pairStatus.stage = "disabled";
        pairStatus.error = "promotion disabled by the caller (negative control)";
        return prim;
    }

    try {
        promoteToRealPair(onEventOption);
    } catch (err) {
        if (modulePermanentlyBroken) {
            try {
                globalThis.p = undefined;
            } catch (withdrawErr) {
                // Exported functions remain blocked by modulePermanentlyBroken.
            }
            const wrapped = new Error(
                "mem: Promotion failed and the module is unrecoverable; "
                + "window.p was withdrawn. failedAt="
                + pairStatus.failedAt + " " + pairStatus.error
            );
            try {
                wrapped.cause = err;
            } catch (causeErr) {
                // Keep the primary failure available through pairStatus.
            }
            throw wrapped;
        }

        if (err !== null
            && (typeof err === "object" || typeof err === "function")) {
            try {
                if (err.cause === undefined)
                    err.cause = pairStatus.error;
            } catch (causeErr) {
                // The original thrown value remains unchanged.
            }
        }
    }

    return prim;
}

export {
    read1, read2, read4, read8,
    write1, write2, write4, write8,
    leakval,
    readInto, writeInto, readBlob, writeBlob, readCString,
    toI64, addrNumber, int64,
    adoptCarrier
};
