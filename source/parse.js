/**
 * @file XDD parse: XML string → EdsModel plain object.
 *
 * Browser-compatible (no fs/path); uses fast-xml-parser.
 * Returns the same nested EdsModel shape as canopen-eds.parseEds.
 *
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { XMLParser } = require('fast-xml-parser');
const { ObjectType, AccessType, DataType } = require('canopen-eds');
const { XDD_TO_DATATYPE, XDD_TO_ACCESS, XDD_TO_BAUD } = require('./lookup-tables');

// ─── XML helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize a fast-xml-parser result to xml2js explicitArray:true style:
 * wrap all element values in arrays, leave '$' and '_' as plain values.
 * @private
 */
function _forceExplicitArray(node) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        return node;
    }

    const result = {};
    for (const [key, val] of Object.entries(node)) {
        if (key === '$' || key === '_') {
            result[key] = val;
        } else {
            const wrapped = Array.isArray(val) ? val : [val];
            result[key] = wrapped.map(item => _forceExplicitArray(item));
        }
    }
    return result;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Convert an xsd:date string ("YYYY-MM-DD", optionally with a suffix) to an
 * EDS "MM-DD-YYYY" string. Purely textual — the calendar date is preserved
 * as-is, with no timezone conversion (reading a UTC instant with local
 * getters used to shift the date by a day for zones west of UTC).
 * Falls back to today's local date.
 * @private
 */
function _formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
    if (m) {
        return `${m[2]}-${m[3]}-${m[1]}`;
    }
    const dt = new Date();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${mm}-${dd}-${dt.getFullYear()}`;
}

/**
 * Convert an xsd:time string ("HH:MM[:SS][zone]") to an EDS "H:MMam/pm"
 * string. Purely textual — the wall-clock time is preserved as-is.
 * @private
 */
function _formatTime(iso) {
    const m = /^(\d{2}):(\d{2})/.exec(String(iso ?? '').trim());
    if (!m) {
        return '12:00AM';
    }
    let h = parseInt(m[1]);
    const mins = m[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) {
        h -= 12;
    }
    if (h === 0) {
        h = 12;
    }
    return `${h}:${mins}${ampm}`;
}

// ─── Parameter helpers ────────────────────────────────────────────────────────

/** @private */
function _getDataTypeFromParam(param) {
    for (const tag of Object.keys(XDD_TO_DATATYPE)) {
        if (param[tag] !== undefined) {
            return XDD_TO_DATATYPE[tag];
        }
    }
    return undefined;
}

/** @private */
function _getLabelFromParam(param) {
    if (param.label && param.label[0]) {
        const lbl = param.label[0];
        return (typeof lbl === 'object') ? (lbl._ || '') : String(lbl);
    }
    if (param.description && param.description[0]) {
        const desc = param.description[0];
        return (typeof desc === 'object') ? (desc._ || '') : String(desc);
    }
    return '';
}

/** @private */
function _getDefaultValueFromParam(param) {
    if (param.defaultValue && param.defaultValue[0]) {
        const attrs = param.defaultValue[0]['$'] || {};
        return attrs.value;
    }
    return undefined;
}

/** @private */
function _getRangeFromParam(param) {
    if (!param.allowedValues || !param.allowedValues[0]) {
        return undefined;
    }
    const av = param.allowedValues[0];
    if (!av.range || !av.range[0]) {
        return undefined;
    }
    const range = av.range[0];
    const low  = range.minValue  && range.minValue[0]  && range.minValue[0]['$']  && range.minValue[0]['$'].value;
    const high = range.maxValue  && range.maxValue[0]  && range.maxValue[0]['$']  && range.maxValue[0]['$'].value;
    if (low !== undefined || high !== undefined) {
        return { lowLimit: low, highLimit: high };
    }
    return undefined;
}

/**
* Extract all <q1:property> values from a parameter node into a plain map.
* @param {object} param - parameter node (already _forceExplicitArray'd)
* @returns {object} { name: value, ... }
* @private
*/
function _getPropertiesFromParam(param) {
    const result = {};
    if (!param) return result;
    // fast-xml-parser with removeNSPrefix:true turns <q1:property> → 'property'
    for (const p of (param['property'] || [])) {
        const a = p['$'] || {};
        if (a.name && a.value !== undefined) {
            result[a.name] = a.value;
        }
    }
    return result;
}

// ─── Entry builders ───────────────────────────────────────────────────────────

/** Build a VAR/DOMAIN entry from CANopenObject/SubObject attrs + parameter. @private */
function _buildVarEntry(attrs, param, objectType) {
    const name = (param && _getLabelFromParam(param)) || attrs.name || `Object_${attrs.index || attrs.subIndex}`;

    if (objectType === ObjectType.DOMAIN) {
        return { parameterName: name, objectType: ObjectType.DOMAIN };
    }

    let dataType    = param ? _getDataTypeFromParam(param) : undefined;
    let accessType  = undefined;
    let defaultValue = undefined;
    let lowLimit    = undefined;
    let highLimit   = undefined;

    if (param) {
        const paramAttrs = param['$'] || {};
        if (paramAttrs.access) {
            accessType = XDD_TO_ACCESS[paramAttrs.access];
        }
        defaultValue = _getDefaultValueFromParam(param);
        const range = _getRangeFromParam(param);
        if (range) {
            lowLimit  = range.lowLimit;
            highLimit = range.highLimit;
        }
    }

    if (accessType === undefined) {
        accessType = AccessType.READ_ONLY;
    }

    if (dataType === undefined) {
        dataType = DataType.UNSIGNED32;
    }

    const pdoMap   = attrs.PDOmapping;
    // Preserve the direction string; fall back to false when absent
    const pdoMapping = (pdoMap !== undefined && pdoMap !== 'no') ? pdoMap : false;

    const props = param ? _getPropertiesFromParam(param) : {};
    const stringLength = props['CO_stringLengthMin'] ? parseInt(props['CO_stringLengthMin']) : undefined;

    // BITSTRING without CO_stringLengthMin is an unbounded blob → DOMAIN (0x000F).
    // BITSTRING with CO_stringLengthMin is a fixed-size byte array → OCTET_STRING (0x000A).
    if (dataType === DataType.OCTET_STRING && stringLength === undefined) {
        dataType = DataType.DOMAIN;
    }

    return {
        parameterName: name,
        objectType:    ObjectType.VAR,
        dataType,
        accessType,
        defaultValue,
        pdoMapping,
        lowLimit,
        highLimit,
        ...(stringLength !== undefined ? { stringLength } : {}),
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an XDD XML string and return a plain EdsModel object.
 *
 * The returned model uses the same nested shape as canopen-eds.parseEds:
 * { fileInfo, deviceInfo, dummyUsage, comments, objects }.
 * Dates are stored as EDS-format strings ("MM-DD-YYYY", "H:MMam/pm").
 *
 * @param {string} xmlString - raw XDD file content.
 * @returns {object} EdsModel plain object.
 * @throws {Error} if the file is not a valid XDD.
 */
function parseXdd(xmlString) {
    const parser = new XMLParser({
        attributesGroupName: '$',
        attributeNamePrefix: '',
        textNodeName: '_',
        removeNSPrefix: true,
        ignoreAttributes: false,
        parseAttributeValue: false,
        parseTagValue: false,
    });

    const doc = _forceExplicitArray(parser.parse(xmlString));

    const container = (doc['ISO15745ProfileContainer'] || [])[0];
    if (!container) {
        throw new Error('Not a valid XDD file: missing ISO15745ProfileContainer');
    }

    const profiles = container['ISO15745Profile'] || [];

    let deviceBody  = null;
    let networkBody = null;

    for (const profile of profiles) {
        const header = profile['ProfileHeader'] && profile['ProfileHeader'][0];
        const body   = profile['ProfileBody']   && profile['ProfileBody'][0];
        if (!header || !body) {
            continue;
        }

        const classId = header['ProfileClassID'] && header['ProfileClassID'][0];
        if (classId === 'Device') {
            deviceBody = body;
        } else if (classId === 'CommunicationNetwork') {
            networkBody = body;
        }
    }

    // ── File metadata ─────────────────────────────────────────────────────────
    let fileName         = 'device.xdd';
    let fileVersion      = '1';
    let createdBy        = '';
    let creationDateRaw  = '';
    let creationTimeRaw  = '';
    let modifiedBy       = '';
    let modificationDateRaw = '';
    let modificationTimeRaw = '';

    const parameterMap = {};

    if (deviceBody) {
        const attrs = deviceBody['$'] || {};
        fileName    = attrs.fileName       || 'device.xdd';
        fileVersion = String(parseInt(attrs.fileVersion) || 1);
        createdBy   = attrs.fileCreator    || '';
        modifiedBy  = attrs.fileModifiedBy || '';

        creationDateRaw     = attrs.fileCreationDate     || '';
        creationTimeRaw     = attrs.fileCreationTime     || '';
        modificationDateRaw = attrs.fileModificationDate || '';
        modificationTimeRaw = attrs.fileModificationTime || '';

        // Build parameter uniqueID lookup map
        const appProcess = deviceBody['ApplicationProcess'] && deviceBody['ApplicationProcess'][0];
        if (appProcess) {
            const paramList = appProcess['parameterList'] && appProcess['parameterList'][0];
            if (paramList) {
                for (const p of (paramList['parameter'] || [])) {
                    const pAttrs = p['$'] || {};
                    if (pAttrs.uniqueID) {
                        parameterMap[pAttrs.uniqueID] = p;
                    }
                }
            }
        }
    }

    // ── Device identity ───────────────────────────────────────────────────────
    let vendorName   = '';
    let vendorNumber = '';
    let productName  = '';
    let productNumber = '';
    let description  = '';
    let orderCode    = '';
    let revisionNumber = '0';

    if (deviceBody) {
        const identity = deviceBody['DeviceIdentity'] && deviceBody['DeviceIdentity'][0];
        if (identity) {
            if (identity.vendorName && identity.vendorName[0]) {
                const vn = identity.vendorName[0];
                vendorName = (typeof vn === 'object') ? (vn._ || '') : String(vn);
            }
            if (identity.vendorID && identity.vendorID[0]) {
                const vi    = identity.vendorID[0];
                vendorNumber = (typeof vi === 'object') ? (vi._ || '0') : String(vi);
            }
            if (identity.productName && identity.productName[0]) {
                const pn = identity.productName[0];
                productName = (typeof pn === 'object') ? (pn._ || '') : String(pn);
            }
            if (identity.productID && identity.productID[0]) {
                const pi = identity.productID[0];
                productNumber = (typeof pi === 'object') ? (pi._ || '') : String(pi);
            }
            const productText = identity.productText && identity.productText[0];
            if (productText && productText.description && productText.description[0]) {
                const de = productText.description[0];
                description = (typeof de === 'object') ? (de._ || '') : String(de);
            }
            if (identity.orderNumber && identity.orderNumber[0]) {
                const on = identity.orderNumber[0];
                orderCode = (typeof on === 'object') ? (on._ || '') : String(on);
            }
            for (const version of (identity.version || [])) {
                const vAttrs = (typeof version === 'object' && version['$']) || {};
                if (vAttrs.versionType === 'SW') {
                    revisionNumber = (typeof version === 'object')
                        ? String(version._ ?? '0')
                        : String(version);
                }
            }
        }
    }

    // ── Network body ──────────────────────────────────────────────────────────
    const baudRates  = [];
    let granularity  = 0;
    let lssSupported = false;
    let dynamicChannelsSupported = 0;
    let groupMessaging     = false;
    let simpleBootUpMaster = false;
    let simpleBootUpSlave  = false;
    const dummyUsage = {};
    const objects    = {};

    if (networkBody) {
        const appLayers       = networkBody['ApplicationLayers']  && networkBody['ApplicationLayers'][0];
        const transportLayers = networkBody['TransportLayers']    && networkBody['TransportLayers'][0];
        const netMgmt         = networkBody['NetworkManagement']  && networkBody['NetworkManagement'][0];

        if (transportLayers) {
            const physLayer = transportLayers['PhysicalLayer'] && transportLayers['PhysicalLayer'][0];
            if (physLayer) {
                const baudRate = physLayer['baudRate'] && physLayer['baudRate'][0];
                if (baudRate) {
                    for (const br of (baudRate['supportedBaudRate'] || [])) {
                        const brAttrs = br['$'] || {};
                        const baud = XDD_TO_BAUD[brAttrs.value];
                        if (baud !== undefined) {
                            baudRates.push(baud);
                        }
                    }
                }
            }
        }

        if (netMgmt) {
            const genFeatures = netMgmt['CANopenGeneralFeatures'] && netMgmt['CANopenGeneralFeatures'][0];
            if (genFeatures) {
                const gf = genFeatures['$'] || {};
                if (gf.granularity !== undefined) {
                    granularity = parseInt(gf.granularity) || 0;
                }
                if (gf.layerSettingServiceSlave !== undefined) {
                    lssSupported = gf.layerSettingServiceSlave === 'true';
                }
                if (gf.dynamicChannels !== undefined) {
                    dynamicChannelsSupported = parseInt(gf.dynamicChannels) || 0;
                }
                if (gf.groupMessaging !== undefined) {
                    groupMessaging = gf.groupMessaging === 'true';
                }
                if (gf.bootUpSlave !== undefined) {
                    simpleBootUpSlave = gf.bootUpSlave === 'true';
                }
            }
            const masterFeatures = netMgmt['CANopenMasterFeatures'] && netMgmt['CANopenMasterFeatures'][0];
            if (masterFeatures && typeof masterFeatures === 'object') {
                const mf = masterFeatures['$'] || {};
                if (mf.bootUpMaster !== undefined) {
                    simpleBootUpMaster = mf.bootUpMaster === 'true';
                }
            }
        }

        if (appLayers) {
            const dummyUsageNode = appLayers['dummyUsage'] && appLayers['dummyUsage'][0];
            if (dummyUsageNode) {
                for (const d of (dummyUsageNode['dummy'] || [])) {
                    const dAttrs = d['$'] || {};
                    const match = /^Dummy([0-9]{4})=([01])$/.exec(dAttrs.entry || '');
                    if (match) {
                        dummyUsage[`Dummy${match[1]}`] = match[2] === '1' ? 1 : 0;
                    }
                }
            }

            const objList = appLayers['CANopenObjectList'] && appLayers['CANopenObjectList'][0];
            if (objList) {
                for (const obj of (objList['CANopenObject'] || [])) {
                    const attrs = obj['$'] || {};
                    if (!attrs.index) {
                        continue;
                    }
                    const index = parseInt(attrs.index, 16);
                    if (isNaN(index)) {
                        continue;
                    }

                    const objectType = parseInt(attrs.objectType) || ObjectType.VAR;
                    const subObjects = obj['CANopenSubObject'] || [];
                    const uid   = attrs.uniqueIDRef;
                    const param = uid ? parameterMap[uid] : null;

                    if (objectType === ObjectType.VAR || objectType === ObjectType.DOMAIN) {
                        const varEntry = _buildVarEntry(attrs, param, objectType);
                        const varProps = param ? _getPropertiesFromParam(param) : {};
                        if (varProps['CO_storageGroup']) {
                            varEntry.storageLocation = varProps['CO_storageGroup'];
                        }
                        objects[index] = varEntry;
                    } else if (
                        objectType === ObjectType.ARRAY ||
                        objectType === ObjectType.RECORD ||
                        objectType === ObjectType.DEFSTRUCT
                    ) {
                        const name = (param && _getLabelFromParam(param)) || attrs.name || `Object_${attrs.index}`;
                        const subs = {};
                        let highestSub = 0;

                        for (const subObj of subObjects) {
                            const subAttrs = subObj['$'] || {};
                            if (!subAttrs.subIndex) {
                                continue;
                            }
                            const subIndex = parseInt(subAttrs.subIndex, 16);
                            if (isNaN(subIndex)) {
                                continue;
                            }

                            const subUid   = subAttrs.uniqueIDRef;
                            const subParam = subUid ? parameterMap[subUid] : null;

                            if (subIndex === 0) {
                                const defVal = subParam ? _getDefaultValueFromParam(subParam) : undefined;
                                const maxSub = defVal !== undefined
                                    ? (parseInt(defVal, String(defVal).startsWith('0x') ? 16 : 10) || 0)
                                    : 0;

                                // Use actual parameterName and accessType from XDD if available
                                let sub0Name = subAttrs.name || 'Max sub-index';
                                let sub0Access = AccessType.READ_ONLY;
                                if (subParam) {
                                    const label = _getLabelFromParam(subParam);
                                    if (label) sub0Name = label;
                                    const pAttrs = subParam['$'] || {};
                                    if (pAttrs.access) {
                                        sub0Access = XDD_TO_ACCESS[pAttrs.access] ?? AccessType.READ_ONLY;
                                    }
                                }

                                subs[0] = {
                                    parameterName: sub0Name,
                                    objectType:    ObjectType.VAR,
                                    dataType:      DataType.UNSIGNED8,
                                    accessType:    sub0Access,
                                    defaultValue:  defVal !== undefined ? defVal : String(maxSub),
                                    pdoMapping:    false,
                                };
                            } else {
                                subs[subIndex] = _buildVarEntry(subAttrs, subParam, ObjectType.VAR);
                                if (subIndex > highestSub) {
                                    highestSub = subIndex;
                                }
                            }
                        }

                        if (!subs[0]) {
                            subs[0] = {
                                parameterName: 'Max sub-index',
                                objectType:    ObjectType.VAR,
                                dataType:      DataType.UNSIGNED8,
                                accessType:    AccessType.READ_ONLY,
                                defaultValue:  String(highestSub),
                                pdoMapping:    false,
                            };
                        }

                        const topProps = param ? _getPropertiesFromParam(param) : {};
                        const topEntry = { parameterName: name, objectType, subObjects: subs };
                        if (topProps['CO_storageGroup']) {
                            topEntry.storageLocation = topProps['CO_storageGroup'];
                        }
                        objects[index] = topEntry;
                    }
                }
            }
        }
    }

    // ── Build nested EdsModel ─────────────────────────────────────────────────
    const objKeys = Object.keys(objects).map(Number);
    const nrOfRXPDO = objKeys.filter(k => k >= 0x1400 && k <= 0x15FF).length;
    const nrOfTXPDO = objKeys.filter(k => k >= 0x1800 && k <= 0x19FF).length;

    // Normalize vendorNumber to padded 8-digit hex format (e.g. '0x00000001').
    const rawVN = vendorNumber || '0';
    const vendorNumHex = /^0[xX]/.test(rawVN)
        ? `0x${parseInt(rawVN, 16).toString(16).toUpperCase().padStart(8, '0')}`
        : `0x${(parseInt(rawVN, 10) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

    return {
        fileInfo: {
            fileName,
            fileVersion,
            fileRevision: '',
            edsVersion:   '4.0',
            description,
            creationTime:     _formatTime(creationTimeRaw),
            creationDate:     _formatDate(creationDateRaw),
            createdBy,
            modificationTime: _formatTime(modificationTimeRaw),
            modificationDate: _formatDate(modificationDateRaw),
            modifiedBy,
        },
        deviceInfo: {
            vendorName,
            vendorNumber:             vendorNumHex,
            productName,
            productNumber:            productNumber || '0',
            revisionNumber,
            orderCode,
            baudRate10:               baudRates.includes(10000),
            baudRate20:               baudRates.includes(20000),
            baudRate50:               baudRates.includes(50000),
            baudRate125:              baudRates.includes(125000),
            baudRate250:              baudRates.includes(250000),
            baudRate500:              baudRates.includes(500000),
            baudRate800:              baudRates.includes(800000),
            baudRate1000:             baudRates.includes(1000000),
            simpleBootUpMaster,
            simpleBootUpSlave,
            granularity,
            dynamicChannelsSupported,
            groupMessaging,
            nrOfRXPDO,
            nrOfTXPDO,
            lssSupported,
        },
        dummyUsage,
        comments: [],
        objects,
    };
}

module.exports = { parseXdd };
