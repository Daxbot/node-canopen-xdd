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

/** Convert an ISO date string or Date → EDS "MM-DD-YYYY" string. @private */
function _formatDate(d) {
    try {
        const dt = new Date(d);
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${mm}-${dd}-${dt.getFullYear()}`;
    } catch {
        return '01-01-1970';
    }
}

/** Convert an ISO date string or Date → EDS "H:MMam/pm" string. @private */
function _formatTime(d) {
    try {
        const dt = new Date(d);
        let h = dt.getHours();
        const m = String(dt.getMinutes()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        if (h > 12) {
            h -= 12;
        }
        if (h === 0) {
            h = 12;
        }
        return `${h}:${m}${ampm}`;
    } catch {
        return '12:00AM';
    }
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
        const pdoMap = attrs.PDOmapping;
        accessType = (pdoMap === 'no') ? AccessType.READ_ONLY : AccessType.READ_WRITE;
    }

    if (dataType === undefined) {
        dataType = DataType.UNSIGNED32;
    }

    const pdoMap   = attrs.PDOmapping;
    // Preserve the direction string; fall back to false when absent
    const pdoMapping = (pdoMap !== undefined && pdoMap !== 'no') ? pdoMap : false;

    const props = param ? _getPropertiesFromParam(param) : {};
    const stringLength = props['CO_stringLengthMin'] ? parseInt(props['CO_stringLengthMin']) : undefined;

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
    let creationDateRaw  = new Date();
    let modifiedBy       = '';
    let modificationDateRaw = new Date();

    const parameterMap = {};

    if (deviceBody) {
        const attrs = deviceBody['$'] || {};
        fileName    = attrs.fileName       || 'device.xdd';
        fileVersion = String(parseInt(attrs.fileVersion) || 1);
        createdBy   = attrs.fileCreator    || '';
        modifiedBy  = attrs.fileModifiedBy || '';

        if (attrs.fileCreationDate) {
            try {
                creationDateRaw = new Date(attrs.fileCreationDate);
            } catch { /* keep default */ }
        }
        if (attrs.fileModificationDate) {
            try {
                modificationDateRaw = new Date(attrs.fileModificationDate);
            } catch { /* keep default */ }
        }

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
    let vendorNumber = 0;
    let productName  = '';

    if (deviceBody) {
        const identity = deviceBody['DeviceIdentity'] && deviceBody['DeviceIdentity'][0];
        if (identity) {
            if (identity.vendorName && identity.vendorName[0]) {
                const vn = identity.vendorName[0];
                vendorName = (typeof vn === 'object') ? (vn._ || '') : String(vn);
            }
            if (identity.vendorID && identity.vendorID[0]) {
                const vi    = identity.vendorID[0];
                const viStr = (typeof vi === 'object') ? (vi._ || '0') : String(vi);
                vendorNumber = parseInt(viStr) || 0;
            }
            if (identity.productName && identity.productName[0]) {
                const pn = identity.productName[0];
                productName = (typeof pn === 'object') ? (pn._ || '') : String(pn);
            }
        }
    }

    // ── Network body ──────────────────────────────────────────────────────────
    const baudRates  = [];
    let granularity  = 0;
    let lssSupported = false;
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
                                subs[0] = {
                                    parameterName: 'Max sub-index',
                                    objectType:    ObjectType.VAR,
                                    dataType:      DataType.UNSIGNED8,
                                    accessType:    AccessType.READ_ONLY,
                                    defaultValue:  String(maxSub),
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
    const vendorNumHex = `0x${(vendorNumber >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

    return {
        fileInfo: {
            fileName,
            fileVersion,
            fileRevision: '',
            edsVersion:   '4.0',
            description:  '',
            creationTime:     _formatTime(creationDateRaw),
            creationDate:     _formatDate(creationDateRaw),
            createdBy,
            modificationTime: _formatTime(modificationDateRaw),
            modificationDate: _formatDate(modificationDateRaw),
            modifiedBy,
        },
        deviceInfo: {
            vendorName,
            vendorNumber:             vendorNumHex,
            productName,
            productNumber:            '0x00000000',
            revisionNumber:           '0x00000000',
            orderCode:                '',
            baudRate10:               baudRates.includes(10000),
            baudRate20:               baudRates.includes(20000),
            baudRate50:               baudRates.includes(50000),
            baudRate125:              baudRates.includes(125000),
            baudRate250:              baudRates.includes(250000),
            baudRate500:              baudRates.includes(500000),
            baudRate800:              baudRates.includes(800000),
            baudRate1000:             baudRates.includes(1000000),
            simpleBootUpMaster:       false,
            simpleBootUpSlave:        false,
            granularity,
            dynamicChannelsSupported: 0,
            groupMessaging:           false,
            nrOfRXPDO:                0,
            nrOfTXPDO:                0,
            lssSupported,
        },
        dummyUsage,
        comments: [],
        objects,
    };
}

module.exports = { parseXdd };
