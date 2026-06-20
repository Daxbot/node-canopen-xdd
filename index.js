/**
 * @file canopen-xdd — browser-compatible CANopen XDD parse/serialize.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { parseXdd }    = require('./source/parse');
const { serializeXdd } = require('./source/serialize');
const { ObjectType, AccessType, DataType } = require('canopen-eds');

module.exports = { parseXdd, serializeXdd, ObjectType, AccessType, DataType };
