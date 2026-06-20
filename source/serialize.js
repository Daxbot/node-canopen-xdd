/**
 * @file XDD serialize: EdsModel plain object → XML string.
 *
 * Browser-compatible (no fs/path).
 * Accepts the same nested EdsModel shape as canopen-eds.parseEds returns.
 *
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { ObjectType, countRxTxPdo } = require('canopen-eds');
const { DATATYPE_TO_XDD, ACCESS_TO_XDD, BAUD_TO_XDD } = require('./lookup-tables');

// ─── Conversion helpers ───────────────────────────────────────────────────────

/**
 * Parse an EDS date string ("MM-DD-YYYY") and optional time string
 * ("H:MMam/pm") into an ISO date string suitable for XDD attributes.
 * Falls back to current date on parse failure.
 * @private
 */
function _parseEdsDate(dateStr, timeStr) {
    try {
        if (!dateStr) {
            throw new Error();
        }
        const [mm, dd, yyyy] = (dateStr || '').split('-');

        let hours = 0, minutes = 0;
        if (timeStr) {
            const m = /^(\d+):(\d+)(AM|PM)$/i.exec(timeStr);
            if (m) {
                hours   = parseInt(m[1]) % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
                minutes = parseInt(m[2]);
            }
        }

        const d = new Date(
            parseInt(yyyy), parseInt(mm) - 1, parseInt(dd),
            hours, minutes
        );
        if (isNaN(d.getTime())) {
            throw new Error();
        }
        return d.toISOString().split('T')[0];
    } catch {
        return new Date().toISOString().split('T')[0];
    }
}

/**
 * Convert a hex string (e.g. '0x00000001') or decimal string / number
 * to a JavaScript number.
 * @private
 */
function _parseNum(s) {
    if (typeof s === 'number') {
        return s;
    }
    if (typeof s === 'bigint') {
        return Number(s);
    }
    if (typeof s === 'string') {
        if (s.startsWith('0x') || s.startsWith('0X')) {
            return parseInt(s, 16) || 0;
        }
        return parseInt(s) || 0;
    }
    return 0;
}

/** @private */
function _isoTime(d) {
    try {
        return new Date(d).toISOString().split('T')[1].replace('Z', '') + '0000000+00:00';
    } catch {
        return new Date().toISOString().split('T')[1].replace('Z', '') + '0000000+00:00';
    }
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** @private */
function _xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** @private */
function _formatDefaultValue(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        if (value === 0) {
            return '0';
        }
        const n = BigInt(value);
        return n < 0n ? String(value) : `0x${n.toString(16).toUpperCase()}`;
    }
    return undefined;
}

// ─── XML fragment builders ────────────────────────────────────────────────────

/** @private */
function _buildVarParameterXml(uid, entry) {
    const accessStr = ACCESS_TO_XDD[entry.accessType] || 'readWrite';
    const dataTag   = DATATYPE_TO_XDD[entry.dataType] || 'UDINT';
    const label     = _xmlEscape(entry.parameterName || '');
    const defVal    = _formatDefaultValue(entry.defaultValue);

    const defaultXml = defVal !== undefined
        ? `\n          <q1:defaultValue value="${_xmlEscape(defVal)}" />`
        : '';

    let limitsXml = '';
    if (entry.lowLimit !== undefined && entry.highLimit !== undefined) {
        limitsXml = `\n          <q1:allowedValues>
            <q1:range>
              <q1:minValue value="${_xmlEscape(entry.lowLimit)}" />
              <q1:maxValue value="${_xmlEscape(entry.highLimit)}" />
            </q1:range>
          </q1:allowedValues>`;
    }

    if (entry.objectType === ObjectType.DOMAIN) {
        return `          <q1:parameter uniqueID="${uid}">
            <label lang="en">${label}</label>
            <${dataTag} />
          </q1:parameter>`;
    }

    return `          <q1:parameter uniqueID="${uid}" access="${accessStr}">
            <label lang="en">${label}</label>
            <${dataTag} />${defaultXml}${limitsXml}
          </q1:parameter>`;
}

/** @private */
function _buildRefParameterXml(uid, parameterName, typeUid) {
    const label = _xmlEscape(parameterName || '');
    return `          <q1:parameter uniqueID="${uid}">
            <label lang="en">${label}</label>
            <q1:dataTypeIDRef uniqueIDRef="${typeUid}" />
          </q1:parameter>`;
}

/** @private */
function _buildArrayTypeDefXml(uid, entry) {
    const name   = _xmlEscape(entry.parameterName || '');
    const subs   = entry.subObjects || {};
    const maxSub = parseInt((subs[0] && subs[0].defaultValue) || 0) || 0;

    let dataTag = 'UDINT';
    for (let i = 1; i <= maxSub; i++) {
        const sub = subs[i];
        if (sub) {
            dataTag = DATATYPE_TO_XDD[sub.dataType] || 'UDINT'; break;
        }
    }

    return `          <q1:array name="${name}" uniqueID="${uid}">
            <q1:subrange lowerLimit="0" upperLimit="${maxSub}" />
            <${dataTag} />
          </q1:array>`;
}

/** @private */
function _buildStructTypeDefXml(uid, entry, indexHex) {
    const name             = _xmlEscape(entry.parameterName || '');
    const subs             = entry.subObjects || {};
    const maxSubDeclared   = parseInt((subs[0] && subs[0].defaultValue) || 0) || 0;
    const maxSubPresent    = Math.max(0, ...Object.keys(subs).map(Number).filter(n => n > 0));
    const maxSub           = Math.max(maxSubDeclared, maxSubPresent);
    const varDecls         = [];

    for (let si = 1; si <= maxSub; si++) {
        const sub = subs[si];
        if (!sub) {
            continue;
        }
        const subDtTag = DATATYPE_TO_XDD[sub.dataType] || 'UDINT';
        const subUid   = `UID_RECSUB_${indexHex}${si.toString(16).toUpperCase().padStart(2, '0')}`;
        varDecls.push(
            `            <q1:varDeclaration name="${_xmlEscape(sub.parameterName || '')}" uniqueID="${subUid}">\n              <${subDtTag} />\n            </q1:varDeclaration>`
        );
    }

    return `          <q1:struct name="${name}" uniqueID="${uid}">
${varDecls.join('\n')}
          </q1:struct>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Serialize an EdsModel plain object to an XDD XML string.
 *
 * Accepts the same nested EdsModel shape as returned by {@link parseXdd}
 * and by `canopen-eds`.parseEds.
 *
 * @param {object} model    - EdsModel (nested fileInfo / deviceInfo).
 * @param {string} [outputFileName] - override the fileName attribute in XML.
 * @returns {string} XDD XML content.
 */
function serializeXdd(model, outputFileName) {
    const fi = model.fileInfo   || {};
    const di = model.deviceInfo || {};

    const fileName    = outputFileName || fi.fileName    || 'device.xdd';
    const fileVersion = fi.fileVersion  || '1';
    const createdBy   = fi.createdBy    || '';
    const modifiedBy  = fi.modifiedBy   || '';

    const creationDateIso     = _parseEdsDate(fi.creationDate,     fi.creationTime);
    const modificationDateIso = _parseEdsDate(fi.modificationDate, fi.modificationTime);

    const vendorName   = di.vendorName  || '';
    const vendorNumber = _parseNum(di.vendorNumber);
    const productName  = di.productName || '';
    const granularity  = di.granularity || 0;
    const lssSupported = di.lssSupported || false;
    const dummyUsage   = model.dummyUsage || {};
    const objects      = model.objects    || {};
    const { rx: nrOfRxPDO, tx: nrOfTxPDO } = countRxTxPdo(objects);

    // Reconstruct baudRates array from individual boolean fields
    const baudRates = [];
    const baudMap = {
        baudRate10:   10000,
        baudRate20:   20000,
        baudRate50:   50000,
        baudRate125:  125000,
        baudRate250:  250000,
        baudRate500:  500000,
        baudRate800:  800000,
        baudRate1000: 1000000,
    };
    for (const [field, hz] of Object.entries(baudMap)) {
        if (di[field]) {
            baudRates.push(hz);
        }
    }

    const parameters      = [];
    const dataTypeArrays  = [];
    const dataTypeStructs = [];
    const objectList      = [];

    const sortedIndices = Object.keys(objects).map(Number).sort((a, b) => a - b);

    for (const index of sortedIndices) {
        const entry      = objects[index];
        const objectType = entry.objectType || ObjectType.VAR;
        const uid        = `UID_OBJ_${index.toString(16).toUpperCase().padStart(4, '0')}`;
        const indexHex   = index.toString(16).toUpperCase().padStart(4, '0');

        if (objectType === ObjectType.VAR || objectType === ObjectType.DOMAIN) {
            parameters.push(_buildVarParameterXml(uid, entry));
            const pdoMap = entry.pdoMapping ? 'optional' : 'no';
            objectList.push(
                `          <CANopenObject index="${indexHex}" name="${_xmlEscape(entry.parameterName || '')}" objectType="${objectType}" PDOmapping="${pdoMap}" uniqueIDRef="${uid}" />`
            );
        } else if (
            objectType === ObjectType.ARRAY ||
            objectType === ObjectType.RECORD ||
            objectType === ObjectType.DEFSTRUCT
        ) {
            const dtUid = objectType === ObjectType.ARRAY
                ? `UID_ARR_${indexHex}`
                : `UID_REC_${indexHex}`;

            parameters.push(_buildRefParameterXml(uid, entry.parameterName, dtUid));

            if (objectType === ObjectType.ARRAY) {
                dataTypeArrays.push(_buildArrayTypeDefXml(dtUid, entry));
            } else {
                dataTypeStructs.push(_buildStructTypeDefXml(dtUid, entry, indexHex));
            }

            const subs           = entry.subObjects || {};
            const maxSubDeclared = parseInt((subs[0] && subs[0].defaultValue) || 0) || 0;
            const maxSubPresent  = Math.max(0, ...Object.keys(subs).map(Number).filter(n => n > 0));
            const maxSub         = Math.max(maxSubDeclared, maxSubPresent);
            const subXml         = [];

            for (let si = 0; si <= maxSub; si++) {
                const sub = subs[si];
                if (!sub) {
                    continue;
                }
                const subUid = `UID_SUB_${indexHex}${si.toString(16).toUpperCase().padStart(2, '0')}`;
                parameters.push(_buildVarParameterXml(subUid, sub));
                subXml.push(
                    `            <CANopenSubObject subIndex="${si.toString(16).toUpperCase().padStart(2, '0')}" name="${_xmlEscape(sub.parameterName || '')}" objectType="7" PDOmapping="${sub.pdoMapping ? 'optional' : 'no'}" uniqueIDRef="${subUid}" />`
                );
            }

            objectList.push(
                `          <CANopenObject index="${indexHex}" name="${_xmlEscape(entry.parameterName || '')}" objectType="${objectType}" uniqueIDRef="${uid}" subNumber="${subXml.length}">\n${subXml.join('\n')}\n          </CANopenObject>`
            );
        }
    }

    const baudRateXml = baudRates
        .map(b => BAUD_TO_XDD[b] ? `          <supportedBaudRate value="${BAUD_TO_XDD[b]}" />` : '')
        .filter(Boolean)
        .join('\n') || '          <supportedBaudRate value="250 Kbps" />';

    const dummyUsageXml = [1, 2, 3, 4, 5, 6, 7].map(i => {
        const key = `Dummy${String(i).padStart(4, '0')}`;
        const val = dummyUsage[key] ? 1 : 0;
        return `          <dummy entry="Dummy${String(i).padStart(4, '0')}=${val}" />`;
    }).join('\n');

    const lssStr = lssSupported ? 'true' : 'false';

    /* eslint-disable max-len */
    return `<?xml version="1.0" encoding="utf-8"?>
<!--File is generated by canopen-xdd-->
<ISO15745ProfileContainer xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.canopen.org/xml/1.1">
  <ISO15745Profile>
    <ProfileHeader xmlns="">
      <ProfileIdentification>CANopen device profile</ProfileIdentification>
      <ProfileRevision>1.1</ProfileRevision>
      <ProfileName />
      <ProfileSource />
      <ProfileClassID>Device</ProfileClassID>
      <ISO15745Reference>
        <ISO15745Part>1</ISO15745Part>
        <ISO15745Edition>1</ISO15745Edition>
        <ProfileTechnology>CANopen</ProfileTechnology>
      </ISO15745Reference>
    </ProfileHeader>
    <ProfileBody xmlns:q1="http://www.canopen.org/xml/1.1" xsi:type="q1:ProfileBody_Device_CANopen" formatName="CANopen" formatVersion="1.0" fileName="${_xmlEscape(fileName)}" fileCreator="${_xmlEscape(createdBy)}" fileCreationDate="${creationDateIso}" fileCreationTime="${_isoTime(creationDateIso)}" fileModifiedBy="${_xmlEscape(modifiedBy)}" fileModificationDate="${modificationDateIso}" fileModificationTime="${_isoTime(modificationDateIso)}" fileVersion="${fileVersion}" supportedLanguages="en" xmlns="">
      <q1:DeviceIdentity>
        <q1:vendorName>${_xmlEscape(vendorName)}</q1:vendorName>
        <q1:vendorID>${vendorNumber}</q1:vendorID>
        <q1:productName>${_xmlEscape(productName)}</q1:productName>
        <q1:productID></q1:productID>
        <q1:version versionType="SW">0</q1:version>
        <q1:version versionType="FW">0</q1:version>
        <q1:version versionType="HW">0</q1:version>
      </q1:DeviceIdentity>
      <q1:DeviceFunction>
        <q1:capabilities>
          <q1:characteristicsList>
            <q1:characteristic>
              <q1:characteristicName>
                <label lang="en">SW library</label>
              </q1:characteristicName>
              <q1:characteristicContent>
                <label lang="en">node-canopen</label>
              </q1:characteristicContent>
            </q1:characteristic>
          </q1:characteristicsList>
        </q1:capabilities>
      </q1:DeviceFunction>
      <q1:ApplicationProcess>
        <q1:dataTypeList>
${dataTypeArrays.join('\n')}
${dataTypeStructs.join('\n')}
        </q1:dataTypeList>
        <q1:parameterList>
${parameters.join('\n')}
        </q1:parameterList>
      </q1:ApplicationProcess>
    </ProfileBody>
  </ISO15745Profile>
  <ISO15745Profile>
    <ProfileHeader xmlns="">
      <ProfileIdentification>CANopen communication network profile</ProfileIdentification>
      <ProfileRevision>1.1</ProfileRevision>
      <ProfileName />
      <ProfileSource />
      <ProfileClassID>CommunicationNetwork</ProfileClassID>
      <ISO15745Reference>
        <ISO15745Part>1</ISO15745Part>
        <ISO15745Edition>1</ISO15745Edition>
        <ProfileTechnology>CANopen</ProfileTechnology>
      </ISO15745Reference>
    </ProfileHeader>
    <ProfileBody xmlns:q2="http://www.canopen.org/xml/1.1" xsi:type="q2:ProfileBody_CommunicationNetwork_CANopen" formatName="CANopen" formatVersion="1.0" fileName="${_xmlEscape(fileName)}" fileCreator="${_xmlEscape(createdBy)}" fileCreationDate="${creationDateIso}" fileCreationTime="${_isoTime(creationDateIso)}" fileModificationDate="${modificationDateIso}" fileModificationTime="${_isoTime(modificationDateIso)}" fileVersion="${fileVersion}" supportedLanguages="en" xmlns="">
      <ApplicationLayers>
        <q2:CANopenObjectList>
${objectList.join('\n')}
        </q2:CANopenObjectList>
        <dummyUsage>
${dummyUsageXml}
        </dummyUsage>
      </ApplicationLayers>
      <TransportLayers>
        <PhysicalLayer>
          <baudRate>
${baudRateXml}
          </baudRate>
        </PhysicalLayer>
      </TransportLayers>
      <NetworkManagement>
        <CANopenGeneralFeatures granularity="${granularity}" nrOfRxPDO="${nrOfRxPDO}" nrOfTxPDO="${nrOfTxPDO}" layerSettingServiceSlave="${lssStr}" />
        <CANopenMasterFeatures />
      </NetworkManagement>
    </ProfileBody>
  </ISO15745Profile>
</ISO15745ProfileContainer>
`;
}

module.exports = { serializeXdd };
