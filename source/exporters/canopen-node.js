/**
 * @file CANopenNode V4 exporter implementation
 * @author Wilkins White
 * @copyright 2024 Daxbot
 *
 * Exports EDS object to CANopenNode V4 compatible OD.c and OD.h files
 */

const { ObjectType, DataType } = require('canopen-eds');

/**
 * Convert parameter name to valid C identifier
 * @param {string} name - parameter name
 * @returns {string} C-valid identifier
 * @private
 */
function makeCName(name) {
    if (!name) {
        return '';
    }

    const tokens = name
        .replace(/-/g, '_')
        .split(/[\W]+/)
        .filter(s => s !== '');

    let output = '';
    let prevChar = ' ';

    for (const tok of tokens) {
        const firstChar = tok[0];

        if (firstChar && /[A-Z]/.test(firstChar) &&
            prevChar && /[A-Z]/.test(prevChar)) {
            output += '_';
        }


        if (tok.length > 1 && /[a-zA-Z]/.test(firstChar)) {
            output += firstChar.toUpperCase() + tok.substring(1);
        } else {
            output += tok;
        }


        prevChar = tok[tok.length - 1];
    }

    if (/[0-9]/.test(output[0])) {
        output = '_' + output;
    } else if (output.length > 1) {
        if (/[a-zA-Z]/.test(output[0]) && /[a-z]/.test(output[1])) {
            output = output[0].toLowerCase() + output.substring(1);
        }

    } else if (output.length === 1) {
        output = output.toLowerCase();
    }

    return output;
}

/**
 * Get C data type properties from CANopen data type
 * @param {DataType} dataType - CANopen data type
 * @param {*} defaultValue - default value
 * @param {number} stringLength - string length for string types
 * @param {string} indexH - index in hex for error reporting
 * @returns {object} data properties
 * @private
 */
function getDataProperties(dataType, defaultValue, stringLength, indexH) {
    const props = {
        cType: 'not specified',
        cTypeArray: '',
        cTypeArray0: '',
        cTypeMultibyte: false,
        cTypeString: false,
        length: 0,
        cValue: null
    };

    let valueDefined = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
    let nobase = 10;

    if (valueDefined && ![
        DataType.VISIBLE_STRING,
        DataType.UNICODE_STRING,
        DataType.OCTET_STRING
    ].includes(dataType)) {
        const trimmed = String(defaultValue).trim();

        if (trimmed.toUpperCase().includes('$NODEID')) {
            const cleaned = trimmed.toUpperCase()
                .replace('$NODEID', '')
                .replace(/\+/g, '')
                .trim() || '0';
            defaultValue = cleaned;
        }

        if (/^0[xX][0-9a-fA-F]+[UL]*$/.test(trimmed)) {
            nobase = 16;
            defaultValue = trimmed.replace(/[UL]/g, '');
        } else if (/^0[0-7]+$/.test(trimmed)) {
            nobase = 8;
        }
    }

    try {
        switch (dataType) {
            case DataType.BOOLEAN:
                props.length = 1;
                props.cType = 'bool_t';
                if (valueDefined) {
                    props.cValue = (String(defaultValue).toLowerCase() === 'false' || defaultValue === 0) ? 'false' : 'true';
                }

                break;

            case DataType.INTEGER8:
                props.length = 1;
                props.cType = 'int8_t';
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER16:
                props.length = 2;
                props.cType = 'int16_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER32:
                props.length = 4;
                props.cType = 'int32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER64:
                props.length = 8;
                props.cType = 'int64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.UNSIGNED8:
                props.length = 1;
                props.cType = 'uint8_t';
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(2, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED16:
                props.length = 2;
                props.cType = 'uint16_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(4, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED32:
                props.length = 4;
                props.cType = 'uint32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(8, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED64:
                props.length = 8;
                props.cType = 'uint64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(16, '0').toUpperCase();
                }

                break;

            case DataType.REAL32:
                props.length = 4;
                props.cType = 'float32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(defaultValue);
                }

                break;

            case DataType.REAL64:
                props.length = 8;
                props.cType = 'float64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(defaultValue);
                }

                break;

            case DataType.VISIBLE_STRING:
                props.cTypeString = true;
                if (valueDefined || stringLength > 0) {
                    const chars = [];
                    let len = 0;

                    if (valueDefined) {
                        const str = String(defaultValue);
                        for (const char of str) {
                            const code = char.charCodeAt(0);
                            if (char === "'") {
                                chars.push("'\\''");
                            } else if (code >= 0x20 && code < 0x7F) {
                                chars.push(`'${char}'`);
                            } else if (code <= 0x7F) {
                                chars.push(`0x${code.toString(16).padStart(2, '0')}`);
                            } else {
                                chars.push(`(char)0x${code.toString(16).padStart(2, '0')}`);
                            }

                            len++;
                        }
                    }

                    for (; len < stringLength; len++) {
                        chars.push('0');
                    }


                    chars.push('0');
                    props.length = len;
                    props.cType = 'char';
                    props.cTypeArray = `[${len + 1}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${chars.join(', ')}}`;
                }
                break;

            case DataType.OCTET_STRING: {
                // Determine byte length: prefer explicit stringLength, then parse hex default
                let len = stringLength > 0 ? stringLength : 0;
                if (!len && valueDefined) {
                    const val = String(defaultValue).trim();
                    if (/^0[xX][0-9a-fA-F]+$/.test(val)) {
                        len = Math.max(1, Math.ceil((val.length - 2) / 2));
                    } else {
                        len = 1;
                    }
                }
                if (len > 0) {
                    const bytes = [];
                    if (valueDefined) {
                        const val = String(defaultValue).trim();
                        let hexStr = /^0[xX]/.test(val) ? val.slice(2) : parseInt(val, 10).toString(16);
                        hexStr = hexStr.padStart(len * 2, '0');
                        for (let i = 0; i < len; i++) {
                            bytes.push('0x' + hexStr.slice(i * 2, i * 2 + 2).toUpperCase());
                        }
                    } else {
                        for (let i = 0; i < len; i++) bytes.push('0x00');
                    }
                    props.cType = 'uint8_t';
                    props.cTypeArray = `[${len}]`;
                    props.cTypeArray0 = '[0]';
                    props.length = len;
                    props.cValue = `{${bytes.join(', ')}}`;
                }
                break;
            }

            case DataType.DOMAIN:
                break;

            case DataType.INTEGER24:
            case DataType.INTEGER40:
            case DataType.INTEGER48:
            case DataType.INTEGER56:
                if (dataType === DataType.INTEGER24) {
                    props.length = 3;
                } else if (dataType === DataType.INTEGER40) {
                    props.length = 5;
                } else if (dataType === DataType.INTEGER48) {
                    props.length = 6;
                } else {
                    props.length = 7;
                }
                if (valueDefined) {
                    const val = BigInt(parseInt(defaultValue, nobase));
                    const bytes = [];
                    for (let i = 0; i < props.length; i++) {
                        bytes.push('0x' + ((val >> BigInt(8 * i)) & BigInt(0xFF)).toString(16).padStart(2, '0').toUpperCase());
                    }

                    props.cType = 'uint8_t';
                    props.cTypeArray = `[${props.length}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${bytes.join(', ')}}`;
                }
                break;

            case DataType.UNSIGNED24:
            case DataType.UNSIGNED40:
            case DataType.UNSIGNED48:
            case DataType.UNSIGNED56:
            case DataType.TIME_OF_DAY:
            case DataType.TIME_DIFFERENCE:
                props.length = dataType === DataType.UNSIGNED24 ? 3 : dataType === DataType.UNSIGNED40 ? 5 : 6;
                if (valueDefined) {
                    const val = BigInt(parseInt(defaultValue, nobase));
                    const bytes = [];
                    for (let i = 0; i < props.length; i++) {
                        bytes.push('0x' + ((val >> BigInt(8 * i)) & BigInt(0xFF)).toString(16).padStart(2, '0').toUpperCase());
                    }

                    props.cType = 'uint8_t';
                    props.cTypeArray = `[${props.length}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${bytes.join(', ')}}`;
                }
                break;
        }
    } catch (error) {
        throw new Error(
            `Failed converting default value ${defaultValue} for OD index 0x${indexH} and data type ${dataType}`,
            { cause: error }
        );
    }

    return props;
}

/**
 * Get OD entry attributes based on access types and data properties
 * @param {object} entry - OD entry (needs accessType)
 * @param {boolean} cTypeMultibyte - is multibyte type
 * @param {boolean} cTypeString - is string type
 * @param {string|null} pdoFlag - PDO attribute string or null
 * @returns {string} attribute string
 * @private
 */
function getAttributes(entry, cTypeMultibyte, cTypeString, pdoFlag) {
    const attributes = [];

    const accessType = entry.accessType || 'ro';
    if (accessType.includes('r') && accessType.includes('w')) {
        attributes.push('ODA_SDO_RW');
    } else if (accessType.includes('r')) {
        attributes.push('ODA_SDO_R');
    } else if (accessType.includes('w')) {
        attributes.push('ODA_SDO_W');
    }

    if (cTypeMultibyte) {
        attributes.push('ODA_MB');
    }

    if (cTypeString) {
        attributes.push('ODA_STR');
    }

    if (pdoFlag) {
        attributes.push(pdoFlag);
    }

    return attributes.length > 0 ? attributes.join(' | ') : '0';
}

/**
 * Derive the PDO attribute flag for an object index.
 * @param {number} index - object index
* @param {boolean|string} pdoMapping - pdoMapping flag from EDS/XDD (string direction or boolean)
 * @param {Set<number>} tpdoMapped - indices found in TPDO mapping objects
 * @param {Set<number>} rpdoMapped - indices found in RPDO mapping objects
 * @returns {string|null}
 * @private
 */
function getPdoFlag(index, pdoMapping, tpdoMapped, rpdoMapped) {
    // Fast path: XDD provides granular PDO direction directly
    if (pdoMapping === 'TPDO') return 'ODA_TPDO';
    if (pdoMapping === 'RPDO') return 'ODA_RPDO';
    if (pdoMapping === 'optional') return 'ODA_TRPDO';
    if (pdoMapping === false || pdoMapping === 'no' || pdoMapping === undefined) return null;

    // Fallback: boolean true → scan concrete PDO mapping objects (EDS compat)
    if (pdoMapping === true) {
        if (!pdoMapping) return null;
        const inT = tpdoMapped.has(index);
        const inR = rpdoMapped.has(index);
        if (inT && inR) return 'ODA_TRPDO';
        if (inT) return 'ODA_TPDO';
        if (inR) return 'ODA_RPDO';
        // pdoMapping=true but not found in any concrete PDO → optional (both directions)
        return 'ODA_TRPDO';
    }

    return null;
}

/**
 * Return { typeName, varName, attrMacro } for a storage group name.
 * @param {string} odname - OD prefix (e.g. 'OD')
 * @param {string} group - storage group (e.g. 'RAM', 'PERSIST_COMM')
 * @returns {{typeName: string, varName: string, attrMacro: string}}
 * @private
 */
function groupNames(odname, group) {
    return {
        typeName: `${odname}_${group}_t`,
        varName: `${odname}_${group}`,
        attrMacro: `${odname}_ATTR_${group}`,
    };
}

/**
 * Prepare data structure from EDS for export
 * @param {Eds} eds - EDS object
 * @returns {object} prepared data
 * @private
 */
function prepareData(eds) {
    const ODCnt = {};
    const ODArrSize = {};
    const ODStorageGroups = [];
    const groupFields = {};   // group → string[] typedef struct body lines
    const groupInits = {};   // group → string[] init field lines

    const odObjsT = [];
    const ODObjs = [];
    const ODList = [];
    const ODDefines = [];
    const ODDefinesLong = [];

    // --- Pass 1: scan PDO mapping objects to determine direction ---
    const tpdoMapped = new Set();
    const rpdoMapped = new Set();

    for (const [indexKey, entry] of Object.entries(eds._model.objects)) {
        const index = parseInt(indexKey, 10);
        const subs = entry.subObjects || {};

        if (index >= 0x1A00 && index <= 0x1AFF) {
            // TPDO mapping: extract referenced object indices from sub default values
            for (const sub of Object.values(subs)) {
                const val = parseInt(sub.defaultValue, 16);
                if (val && !isNaN(val)) {
                    tpdoMapped.add((val >>> 16) & 0xFFFF);
                }
            }
        } else if (index >= 0x1600 && index <= 0x17FF) {
            // RPDO mapping
            for (const sub of Object.values(subs)) {
                const val = parseInt(sub.defaultValue, 16);
                if (val && !isNaN(val)) {
                    rpdoMapped.add((val >>> 16) & 0xFFFF);
                }
            }
        }
    }

    // --- Helper: ensure group data structures exist ---
    function ensureGroup(group) {
        if (!ODStorageGroups.includes(group)) {
            ODStorageGroups.push(group);
            groupFields[group] = [];
            groupInits[group] = [];
        }
    }

    // --- Pass 2: build all OD structures ---
    for (const [indexKey, entry] of Object.entries(eds._model.objects)) {
        const index = parseInt(indexKey, 10);
        const indexH = index.toString(16).padStart(4, '0').toUpperCase();
        const cName = makeCName(entry.parameterName);
        const varName = `${indexH}_${cName}`;

        const storageGroup = entry.storageLocation || 'RAM';
        const gVar = `OD_${storageGroup}`;

        ensureGroup(storageGroup);

        // Range-based feature counting
        let countLabel = null;
        if (index >= 0x1200 && index <= 0x127F) countLabel = 'SDO_SRV';
        else if (index >= 0x1280 && index <= 0x12FF) countLabel = 'SDO_CLI';
        else if (index >= 0x1400 && index <= 0x15FF) countLabel = 'RPDO';
        else if (index >= 0x1800 && index <= 0x19FF) countLabel = 'TPDO';
        else {
            const POINT_LABELS = {
                0x1000: 'NMT', 0x1001: 'EM', 0x1005: 'SYNC',
                0x1006: 'SYNC_PROD', 0x1010: 'STORAGE', 0x1012: 'TIME',
                0x1014: 'EM_PROD', 0x1016: 'HB_CONS', 0x1017: 'HB_PROD',
                0x1300: 'GFC', 0x1301: 'SRDO',
            };
            countLabel = POINT_LABELS[index] || null;
        }

        // Build sorted sub-entries array (all subs including sub0)
        const subEntries = entry.objectType === ObjectType.VAR
            ? []
            : Object.entries(entry.subObjects || {})
                .map(([k, v]) => ({ ...v, subIndex: parseInt(k) }))
                .sort((a, b) => a.subIndex - b.subIndex);

        let subEntriesCount = 0;
        let objectTypeStr = 'VAR';

        if (subEntries.length === 0) {
            // ── VAR ──────────────────────────────────────────────────────────
            objectTypeStr = 'VAR';
            subEntriesCount = 1;

            const dataProps = getDataProperties(
                entry.dataType, entry.defaultValue, entry.stringLength, indexH
            );
            const pdoFlag = getPdoFlag(index, entry.pdoMapping, tpdoMapped, rpdoMapped);
            const attr = getAttributes(entry, dataProps.cTypeMultibyte, dataProps.cTypeString, pdoFlag);

            if (dataProps.length > 0) {
                const hasArraySuffix = dataProps.cTypeArray && dataProps.cTypeArray.startsWith('[');
                groupFields[storageGroup].push(
                    `    ${dataProps.cType} x${varName}${dataProps.cTypeArray};`
                );
                const initVal = dataProps.cValue != null ? dataProps.cValue : '0';
                groupInits[storageGroup].push(`    .x${varName} = ${initVal},`);

                const dataOrigExpr = hasArraySuffix
                    ? `&${gVar}.x${varName}[0]`
                    : `&${gVar}.x${varName}`;

                odObjsT.push(`OD_obj_var_t o_${varName};`);
                ODObjs.push(`    .o_${varName} = {`);
                ODObjs.push(`        .dataOrig = ${dataOrigExpr},`);
                ODObjs.push(`        .attribute = ${attr},`);
                ODObjs.push(`        .dataLength = ${dataProps.length}`);
                ODObjs.push(`    },`);
            } else {
                odObjsT.push(`OD_obj_var_t o_${varName};`);
                ODObjs.push(`    .o_${varName} = {`);
                ODObjs.push(`        .dataOrig = NULL,`);
                ODObjs.push(`        .attribute = ${attr},`);
                ODObjs.push(`        .dataLength = 0`);
                ODObjs.push(`    },`);
            }

        } else if (entry.objectType === ObjectType.ARRAY) {
            // ── ARRAY ────────────────────────────────────────────────────────
            objectTypeStr = 'ARR';
            subEntriesCount = subEntries.length;
            ODArrSize[indexH] = subEntriesCount - 1;

            if (subEntriesCount > 1) {
                const sub0 = subEntries[0];
                const firstDataSub = subEntries[1];

                const elemProps = getDataProperties(
                    firstDataSub?.dataType ?? entry.dataType,
                    firstDataSub?.defaultValue,
                    firstDataSub?.stringLength,
                    indexH
                );
                // sub0 is always UNSIGNED8 — compute its attribute without ODA_MB
                const sub0Attr = getAttributes(
                    sub0 ?? { accessType: 'ro' }, false, false, null
                );
                const elemAttr = getAttributes(
                    firstDataSub ?? { accessType: 'ro' },
                    elemProps.cTypeMultibyte, elemProps.cTypeString, null
                );

                // sub0 struct field + init
                groupFields[storageGroup].push(`    uint8_t x${varName}_sub0;`);
                const sub0Props = getDataProperties(DataType.UNSIGNED8, sub0?.defaultValue, null, indexH);
                groupInits[storageGroup].push(
                    `    .x${varName}_sub0 = ${sub0Props.cValue ?? '0x00'},`
                );

                let dataOrigArr = 'NULL';
                if (elemProps.length > 0) {
                    // Array element struct field + init
                    groupFields[storageGroup].push(
                        `    ${elemProps.cType} x${varName}[OD_CNT_ARR_${indexH}];`
                    );
                    const arrInits = subEntries.slice(1).map(sub => {
                        const dp = getDataProperties(sub.dataType, sub.defaultValue, sub.stringLength, indexH);
                        return dp.cValue != null ? dp.cValue : '0';
                    });
                    groupInits[storageGroup].push(
                        `    .x${varName} = {${arrInits.join(', ')}},`
                    );
                    dataOrigArr = `&${gVar}.x${varName}[0]`;
                }

                odObjsT.push(`OD_obj_array_t o_${varName};`);
                ODObjs.push(`    .o_${varName} = {`);
                ODObjs.push(`        .dataOrig0 = &${gVar}.x${varName}_sub0,`);
                ODObjs.push(`        .dataOrig = ${dataOrigArr},`);
                ODObjs.push(`        .attribute0 = ${sub0Attr},`);
                ODObjs.push(`        .attribute = ${elemAttr},`);
                ODObjs.push(`        .dataElementLength = ${elemProps.length},`);
                ODObjs.push(`        .dataElementSizeof = ${elemProps.length > 0 ? `sizeof(${elemProps.cType}${elemProps.cTypeArray})` : '0'}`);
                ODObjs.push(`    },`);
            }

        } else if (entry.objectType === ObjectType.RECORD) {
            // ── RECORD ───────────────────────────────────────────────────────
            objectTypeStr = 'REC';
            subEntriesCount = subEntries.length;

            if (subEntriesCount > 1) {
                // Build nested struct field declarations and initializers
                const nestedFields = [];
                const nestedInits = [];
                const subMeta = [];  // { subCName, dataProps } per sub

                for (const sub of subEntries) {
                    const subCName = makeCName(sub.parameterName);
                    const dataProps = getDataProperties(
                        sub.dataType, sub.defaultValue, sub.stringLength, indexH
                    );
                    subMeta.push({ subCName, dataProps });

                    if (dataProps.length > 0) {
                        nestedFields.push(
                            `        ${dataProps.cType} ${subCName}${dataProps.cTypeArray};`
                        );
                        const initVal = dataProps.cValue != null ? dataProps.cValue : '0';
                        nestedInits.push(`        .${subCName} = ${initVal}`);
                    }
                }

                // typedef body: nested struct
                groupFields[storageGroup].push(`    struct {`);
                for (const f of nestedFields) {
                    groupFields[storageGroup].push(f);
                }
                groupFields[storageGroup].push(`    } x${varName};`);

                // init body: nested struct init
                groupInits[storageGroup].push(`    .x${varName} = {`);
                for (let i = 0; i < nestedInits.length; i++) {
                    const comma = i < nestedInits.length - 1 ? ',' : '';
                    groupInits[storageGroup].push(nestedInits[i] + comma);
                }
                groupInits[storageGroup].push(`    },`);

                // ODObjs record entries
                odObjsT.push(`OD_obj_record_t o_${varName}[${subEntriesCount}];`);
                ODObjs.push(`    .o_${varName} = {`);
                for (let i = 0; i < subEntries.length; i++) {
                    const sub = subEntries[i];
                    const { subCName, dataProps } = subMeta[i];
                    const attr = getAttributes(
                        sub, dataProps.cTypeMultibyte, dataProps.cTypeString, null
                    );
                    const dataOrigExpr = dataProps.length > 0
                        ? `&${gVar}.x${varName}.${subCName}`
                        : 'NULL';
                    const isLast = i === subEntries.length - 1;

                    ODObjs.push(`        {`);
                    ODObjs.push(`            .dataOrig = ${dataOrigExpr},`);
                    ODObjs.push(`            .subIndex = ${sub.subIndex},`);
                    ODObjs.push(`            .attribute = ${attr},`);
                    ODObjs.push(`            .dataLength = ${dataProps.length}`);
                    ODObjs.push(isLast ? `        }` : `        },`);
                }
                ODObjs.push(`    },`);
            }
        }

        if (subEntriesCount > 0) {
            ODDefines.push(
                `#define OD_ENTRY_H${indexH} &OD->list[${ODList.length}]`
            );
            ODDefinesLong.push(
                `#define OD_ENTRY_H${varName} &OD->list[${ODList.length}]`
            );
            ODList.push(
                `{0x${indexH}, 0x${subEntriesCount.toString(16).padStart(2, '0')}, ODT_${objectTypeStr}, &ODObjs.o_${varName}, NULL}`
            );

            if (countLabel) {
                ODCnt[countLabel] = (ODCnt[countLabel] || 0) + 1;
            }
        }
    }

    return {
        ODCnt,
        ODArrSize,
        ODStorageGroups,
        groupFields,
        groupInits,
        ODObjs_t: odObjsT,
        ODObjs,
        ODList,
        ODDefines,
        ODDefinesLong,
    };
}

/**
 * Export EDS to CANopenNode OD.h and OD.c file contents.
* @param {Eds|object} eds - EDS/XDD object to export (Eds instance or plain model)
 * @param {string} [filename] - base filename (no extension) used in #include and guards
 * @returns {{ header: string, source: string }}
 */
function exportOD(eds, filename = 'OD') {
    // Support both Eds objects and plain model objects
    const model = eds._model || eds;
    const prepared = prepareData({ _model: model });
    const odname = 'OD';

    return {
        header: exportODHeader(filename, odname, { _model: model }, prepared),
        source: exportODSource(filename, odname, prepared),
    };
}

/**
 * Build OD.h file content.
 * @param filename
 * @param odname
 * @param eds
 * @param prepared
 * @private
 * @returns {string}
 */
function exportODHeader(filename, odname, eds, prepared) {
    const lines = [];

    lines.push(`/*******************************************************************************
    CANopen Object Dictionary definition for CANopenNode V4

    This file was automatically generated by node-canopen

    https://github.com/CANopenNode/CANopenNode
    https://github.com/DaxBot/node-canopen

    DON'T EDIT THIS FILE MANUALLY !!!!
********************************************************************************

    File info:
        File Names:   ${filename}.h; ${filename}.c
        Project File: ${eds.fileName || 'unknown'}
        File Version: ${eds.fileVersion || 1}

        Created:      ${new Date().toLocaleString()}
        Created By:   node-canopen
        Modified:     ${new Date().toLocaleString()}
        Modified By:  node-canopen

    Device Info:
        Vendor Name:  ${eds.vendorName || ''}
        Vendor ID:    0x${(eds.vendorNumber || 0).toString(16)}
        Product Name: ${eds.productName || ''}
        Product ID:   ${eds.productNumber || ''}

        Description:  ${eds.description || ''}
*******************************************************************************/

#ifndef ${odname}_H
#define ${odname}_H
/*******************************************************************************
    Counters of OD objects
*******************************************************************************/`);

    for (const [key, value] of Object.entries(prepared.ODCnt)) {
        lines.push(`#define ${odname}_CNT_${key} ${value}`);
    }

    lines.push(`

/*******************************************************************************
    Sizes of OD arrays
*******************************************************************************/`);

    for (const [key, value] of Object.entries(prepared.ODArrSize)) {
        lines.push(`#define ${odname}_CNT_ARR_${key} ${value}`);
    }

    lines.push(`

/*******************************************************************************
    OD data declaration of all groups
*******************************************************************************/`);

    // Emit typedef struct + extern for each storage group
    for (const group of prepared.ODStorageGroups) {
        const { typeName, varName, attrMacro } = groupNames(odname, group);
        const fields = prepared.groupFields[group] || [];

        lines.push(`typedef struct {`);
        if (fields.length > 0) {
            lines.push(fields.join('\n'));
        } else {
            lines.push(`    uint8_t _placeholder;`);
        }
        lines.push(`} ${typeName};`);
        lines.push('');
    }

    for (const group of prepared.ODStorageGroups) {
        const { typeName, varName, attrMacro } = groupNames(odname, group);
        lines.push(`#ifndef ${attrMacro}`);
        lines.push(`#define ${attrMacro}`);
        lines.push(`#endif`);
        lines.push(`extern ${attrMacro} ${typeName} ${varName};`);
        lines.push('');
    }

    lines.push(`#ifndef ${odname}_ATTR_OD
#define ${odname}_ATTR_OD
#endif
extern ${odname}_ATTR_OD OD_t *${odname};

/*******************************************************************************
    Object dictionary entries - shortcuts
*******************************************************************************/`);

    lines.push(prepared.ODDefines.join('\n'));

    lines.push(`

/*******************************************************************************
    Object dictionary entries - shortcuts with names
*******************************************************************************/`);

    lines.push(prepared.ODDefinesLong.join('\n'));

    // OD_INIT_CONFIG macro for CO_MULTIPLE_OD support
    const cntDefs = prepared.ODCnt;
    const defSet = new Set(prepared.ODDefines.map(d => d.replace(/#define (\S+) .*/, '$1')));
    function hasCnt(k) { return !!cntDefs[k]; }
    function hasEntry(h) { return defSet.has(`OD_ENTRY_H${h}`); }

    lines.push(`

/*******************************************************************************
    OD config structure
*******************************************************************************/
#ifdef CO_MULTIPLE_OD
#define OD_INIT_CONFIG(config) {\\
    (config).CNT_NMT = ${hasCnt('NMT') ? `${odname}_CNT_NMT` : '0'};\\
    (config).ENTRY_H1017 = ${hasEntry('1017') ? `${odname}_ENTRY_H1017` : 'NULL'};\\
    (config).CNT_HB_CONS = ${hasCnt('HB_CONS') ? `${odname}_CNT_HB_CONS` : '0'};\\
    (config).CNT_ARR_1016 = ${prepared.ODArrSize['1016'] != null ? `${odname}_CNT_ARR_1016` : '0'};\\
    (config).ENTRY_H1016 = ${hasEntry('1016') ? `${odname}_ENTRY_H1016` : 'NULL'};\\
    (config).CNT_EM = ${hasCnt('EM') ? `${odname}_CNT_EM` : '0'};\\
    (config).ENTRY_H1001 = ${hasEntry('1001') ? `${odname}_ENTRY_H1001` : 'NULL'};\\
    (config).ENTRY_H1014 = ${hasEntry('1014') ? `${odname}_ENTRY_H1014` : 'NULL'};\\
    (config).ENTRY_H1015 = ${hasEntry('1015') ? `${odname}_ENTRY_H1015` : 'NULL'};\\
    (config).CNT_ARR_1003 = ${prepared.ODArrSize['1003'] != null ? `${odname}_CNT_ARR_1003` : '0'};\\
    (config).ENTRY_H1003 = ${hasEntry('1003') ? `${odname}_ENTRY_H1003` : 'NULL'};\\
    (config).CNT_SDO_SRV = ${hasCnt('SDO_SRV') ? `${odname}_CNT_SDO_SRV` : '0'};\\
    (config).ENTRY_H1200 = ${hasEntry('1200') ? `${odname}_ENTRY_H1200` : 'NULL'};\\
    (config).CNT_SDO_CLI = ${hasCnt('SDO_CLI') ? `${odname}_CNT_SDO_CLI` : '0'};\\
    (config).ENTRY_H1280 = ${hasEntry('1280') ? `${odname}_ENTRY_H1280` : 'NULL'};\\
    (config).CNT_TIME = ${hasCnt('TIME') ? `${odname}_CNT_TIME` : '0'};\\
    (config).ENTRY_H1012 = ${hasEntry('1012') ? `${odname}_ENTRY_H1012` : 'NULL'};\\
    (config).CNT_SYNC = ${hasCnt('SYNC') ? `${odname}_CNT_SYNC` : '0'};\\
    (config).ENTRY_H1005 = ${hasEntry('1005') ? `${odname}_ENTRY_H1005` : 'NULL'};\\
    (config).ENTRY_H1006 = ${hasEntry('1006') ? `${odname}_ENTRY_H1006` : 'NULL'};\\
    (config).ENTRY_H1007 = ${hasEntry('1007') ? `${odname}_ENTRY_H1007` : 'NULL'};\\
    (config).ENTRY_H1019 = ${hasEntry('1019') ? `${odname}_ENTRY_H1019` : 'NULL'};\\
    (config).CNT_RPDO = ${hasCnt('RPDO') ? `${odname}_CNT_RPDO` : '0'};\\
    (config).ENTRY_H1400 = ${hasEntry('1400') ? `${odname}_ENTRY_H1400` : 'NULL'};\\
    (config).ENTRY_H1600 = ${hasEntry('1600') ? `${odname}_ENTRY_H1600` : 'NULL'};\\
    (config).CNT_TPDO = ${hasCnt('TPDO') ? `${odname}_CNT_TPDO` : '0'};\\
    (config).ENTRY_H1800 = ${hasEntry('1800') ? `${odname}_ENTRY_H1800` : 'NULL'};\\
    (config).ENTRY_H1A00 = ${hasEntry('1A00') ? `${odname}_ENTRY_H1A00` : 'NULL'};\\
    (config).CNT_LEDS = 0;\\
    (config).CNT_GFC = ${hasCnt('GFC') ? `${odname}_CNT_GFC` : '0'};\\
    (config).ENTRY_H1300 = ${hasEntry('1300') ? `${odname}_ENTRY_H1300` : 'NULL'};\\
    (config).CNT_SRDO = ${hasCnt('SRDO') ? `${odname}_CNT_SRDO` : '0'};\\
    (config).ENTRY_H1301 = ${hasEntry('1301') ? `${odname}_ENTRY_H1301` : 'NULL'};\\
    (config).ENTRY_H1381 = ${hasEntry('1381') ? `${odname}_ENTRY_H1381` : 'NULL'};\\
    (config).ENTRY_H13FE = ${hasEntry('13FE') ? `${odname}_ENTRY_H13FE` : 'NULL'};\\
    (config).ENTRY_H13FF = ${hasEntry('13FF') ? `${odname}_ENTRY_H13FF` : 'NULL'};\\
    (config).CNT_LSS_SLV = 0;\\
    (config).CNT_LSS_MST = 0;\\
    (config).CNT_GTWA = 0;\\
    (config).CNT_TRACE = 0;\\
}
#endif`);

    lines.push(`
#endif /* ${odname}_H */`);

    return lines.join('\n') + '\n';
}

/**
 * Build OD.c file content.
 * @param filename
 * @param odname
 * @param prepared
 * @private
 * @returns {string}
 */
function exportODSource(filename, odname, prepared) {
    const lines = [];

    lines.push(`/*******************************************************************************
    CANopen Object Dictionary definition for CANopenNode V4

    This file was automatically generated by node-canopen

    https://github.com/CANopenNode/CANopenNode
    https://github.com/DaxBot/node-canopen

    DON'T EDIT THIS FILE MANUALLY, UNLESS YOU KNOW WHAT YOU ARE DOING !!!!
*******************************************************************************/

#define OD_DEFINITION
#include "301/CO_ODinterface.h"
#include "${filename}.h"

#if CO_VERSION_MAJOR < 4
#error This Object dictionary is compatible with CANopenNode V4.0 and above!
#endif

/*******************************************************************************
    OD data initialization of all groups
*******************************************************************************/`);

    for (const group of prepared.ODStorageGroups) {
        const { typeName, varName, attrMacro } = groupNames(odname, group);
        const inits = prepared.groupInits[group] || [];

        lines.push(`${attrMacro} ${typeName} ${varName} = {`);
        if (inits.length > 0) {
            // Remove trailing comma from last init line to match reference style
            const last = inits[inits.length - 1];
            const trimmedInits = [...inits.slice(0, -1), last.endsWith(',') ? last.slice(0, -1) : last];
            lines.push(trimmedInits.join('\n'));
        }
        lines.push(`};`);
        lines.push('');
    }

    lines.push(`/*******************************************************************************
    All OD objects (constant definitions)
*******************************************************************************/
typedef struct {
    ${prepared.ODObjs_t.join('\n    ')}
} ${odname}Objs_t;

static CO_PROGMEM ${odname}Objs_t ${odname}Objs = {
${prepared.ODObjs.join('\n')}
};

/*******************************************************************************
    Object dictionary
*******************************************************************************/
static ${odname}_ATTR_OD OD_entry_t ${odname}List[] = {
    ${prepared.ODList.join(',\n    ')},
    {0x0000, 0x00, 0, NULL, NULL}
};

static OD_t _${odname} = {
    (sizeof(${odname}List) / sizeof(${odname}List[0])) - 1,
    &${odname}List[0]
};

OD_t *${odname} = &_${odname};`);

    return lines.join('\n') + '\n';
}

module.exports = exports = { exportOD };
