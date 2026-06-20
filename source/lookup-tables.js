/**
 * @file XDD ↔ CANopen type/access/baud-rate lookup tables.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { DataType, AccessType } = require('canopen-eds');

/** Map from XDD element tag names to CANopen DataType values. */
const XDD_TO_DATATYPE = {
    BOOL:      DataType.BOOLEAN,
    CHAR:      DataType.INTEGER8,
    SINT:      DataType.INTEGER8,
    INT:       DataType.INTEGER16,
    DINT:      DataType.INTEGER32,
    LINT:      DataType.INTEGER64,
    BYTE:      DataType.UNSIGNED8,
    USINT:     DataType.UNSIGNED8,
    WORD:      DataType.UNSIGNED16,
    UINT:      DataType.UNSIGNED16,
    DWORD:     DataType.UNSIGNED32,
    UDINT:     DataType.UNSIGNED32,
    LWORD:     DataType.UNSIGNED64,
    ULINT:     DataType.UNSIGNED64,
    REAL:      DataType.REAL32,
    LREAL:     DataType.REAL64,
    STRING:    DataType.VISIBLE_STRING,
    WSTRING:   DataType.UNICODE_STRING,
    BITSTRING: DataType.OCTET_STRING,
};

/** Map from CANopen DataType values to XDD element tag names. */
const DATATYPE_TO_XDD = {
    [DataType.BOOLEAN]:        'BOOL',
    [DataType.INTEGER8]:       'SINT',
    [DataType.INTEGER16]:      'INT',
    [DataType.INTEGER32]:      'DINT',
    [DataType.INTEGER64]:      'LINT',
    [DataType.UNSIGNED8]:      'USINT',
    [DataType.UNSIGNED16]:     'UINT',
    [DataType.UNSIGNED32]:     'UDINT',
    [DataType.UNSIGNED64]:     'ULINT',
    [DataType.REAL32]:         'REAL',
    [DataType.REAL64]:         'LREAL',
    [DataType.VISIBLE_STRING]: 'STRING',
    [DataType.UNICODE_STRING]: 'WSTRING',
    [DataType.OCTET_STRING]:   'BITSTRING',
    [DataType.DOMAIN]:         'BITSTRING',
};

/** Map from XDD access attribute values to CANopen AccessType values. */
const XDD_TO_ACCESS = {
    'readOnly':        AccessType.READ_ONLY,
    'read':            AccessType.READ_ONLY,
    'readWrite':       AccessType.READ_WRITE,
    'readWriteInput':  AccessType.READ_WRITE,
    'readWriteOutput': AccessType.READ_WRITE,
    'writeOnly':       AccessType.WRITE_ONLY,
    'write':           AccessType.WRITE_ONLY,
    'const':           AccessType.CONSTANT,
    'noAccess':        AccessType.READ_ONLY,
};

/** Map from CANopen AccessType values to XDD access attribute values. */
const ACCESS_TO_XDD = {
    [AccessType.READ_ONLY]:  'readOnly',
    [AccessType.READ_WRITE]: 'readWrite',
    [AccessType.WRITE_ONLY]: 'writeOnly',
    [AccessType.CONSTANT]:   'const',
};

/** Map from baud rate numbers (bps) to XDD baud rate strings. */
const BAUD_TO_XDD = {
    10000:   '10 Kbps',
    20000:   '20 Kbps',
    50000:   '50 Kbps',
    125000:  '125 Kbps',
    250000:  '250 Kbps',
    500000:  '500 Kbps',
    800000:  '800 Kbps',
    1000000: '1000 Kbps',
};

/** Map from XDD baud rate strings to baud rate numbers (bps). */
const XDD_TO_BAUD = {
    '10 Kbps':   10000,
    '20 Kbps':   20000,
    '50 Kbps':   50000,
    '125 Kbps':  125000,
    '250 Kbps':  250000,
    '500 Kbps':  500000,
    '800 Kbps':  800000,
    '1000 Kbps': 1000000,
};

module.exports = {
    XDD_TO_DATATYPE,
    DATATYPE_TO_XDD,
    XDD_TO_ACCESS,
    ACCESS_TO_XDD,
    BAUD_TO_XDD,
    XDD_TO_BAUD,
};
