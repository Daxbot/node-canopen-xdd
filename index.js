/**
 * @file canopen-xdd — browser-compatible CANopen XDD parse/serialize.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { parseXdd }    = require('./source/parse');
const { serializeXdd } = require('./source/serialize');
const { exportOD }     = require('./source/exporters/canopen-node');
const { ObjectType, AccessType, DataType } = require('canopen-eds');

module.exports = { parseXdd, serializeXdd, exportOD, ObjectType, AccessType, DataType };
