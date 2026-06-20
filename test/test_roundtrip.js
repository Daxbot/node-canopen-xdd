'use strict';

const chai   = require('chai');
const { parseXdd, serializeXdd, ObjectType, AccessType, DataType } = require('..');
const expect = chai.expect;

/** Build a representative EdsModel covering all relevant object types. */
function buildTestModel() {
    return {
        fileInfo: {
            fileName:         'test.xdd',
            fileVersion:      '1',
            createdBy:        'Test',
            creationDate:     '01-01-2024',
            creationTime:     '12:00AM',
            modifiedBy:       'Test',
            modificationDate: '01-01-2024',
            modificationTime: '12:00AM',
        },
        deviceInfo: {
            vendorName:    'Test Vendor',
            vendorNumber:  '0x00000001',
            productName:   'Test Device',
            productNumber: '0x00000000',
            baudRate250:   true,
            baudRate500:   true,
            granularity:   0,
            lssSupported:  false,
        },
        dummyUsage: {},
        comments:   [],
        objects: {
            0x2000: {
                parameterName: 'Read-only UINT32',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    AccessType.READ_ONLY,
                defaultValue:  '0xFF',
                pdoMapping:    false,
            },
            0x2001: {
                parameterName: 'Read-write INT32',
                objectType:    ObjectType.VAR,
                dataType:      DataType.INTEGER32,
                accessType:    AccessType.READ_WRITE,
                defaultValue:  '-1',
                pdoMapping:    false,
            },
            0x2002: {
                parameterName: 'Float value',
                objectType:    ObjectType.VAR,
                dataType:      DataType.REAL32,
                accessType:    AccessType.READ_WRITE,
                defaultValue:  '0',
                pdoMapping:    false,
            },
            0x2003: {
                parameterName: 'Device name',
                objectType:    ObjectType.VAR,
                dataType:      DataType.VISIBLE_STRING,
                accessType:    AccessType.READ_ONLY,
                pdoMapping:    false,
            },
            0x2010: {
                parameterName: 'Test array',
                objectType:    ObjectType.ARRAY,
                subObjects: {
                    0: { parameterName: 'Max sub-index', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8, accessType: AccessType.READ_ONLY, defaultValue: '3', pdoMapping: false },
                    1: { parameterName: 'Element 1', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '100', pdoMapping: false },
                    2: { parameterName: 'Element 2', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '200', pdoMapping: false },
                    3: { parameterName: 'Element 3', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '300', pdoMapping: false },
                },
            },
            0x2020: {
                parameterName: 'Test record',
                objectType:    ObjectType.RECORD,
                subObjects: {
                    0: { parameterName: 'Max sub-index', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8, accessType: AccessType.READ_ONLY, defaultValue: '3', pdoMapping: false },
                    1: { parameterName: 'Field A', objectType: ObjectType.VAR, dataType: DataType.INTEGER32,  accessType: AccessType.READ_ONLY,  pdoMapping: false },
                    2: { parameterName: 'Field B', objectType: ObjectType.VAR, dataType: DataType.REAL32,    accessType: AccessType.READ_WRITE, defaultValue: '0', pdoMapping: false },
                    3: { parameterName: 'Field C', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8, accessType: AccessType.READ_WRITE, pdoMapping: false },
                },
            },
        },
    };
}

describe('canopen-xdd', function () {
    describe('parseXdd', function () {
        let model;
        let reparsed;

        before(function () {
            model    = buildTestModel();
            const xml = serializeXdd(model);
            reparsed = parseXdd(xml);
        });

        it('should return fileInfo with a fileName', function () {
            expect(reparsed.fileInfo.fileName).to.equal('test.xdd');
        });

        it('should parse vendorName and vendorNumber into deviceInfo', function () {
            expect(reparsed.deviceInfo.vendorName).to.equal('Test Vendor');
            expect(reparsed.deviceInfo.vendorNumber).to.equal('0x00000001');
        });

        it('should parse productName into deviceInfo', function () {
            expect(reparsed.deviceInfo.productName).to.equal('Test Device');
        });

        it('should parse baudRates as individual boolean fields', function () {
            expect(reparsed.deviceInfo.baudRate250).to.equal(true);
            expect(reparsed.deviceInfo.baudRate500).to.equal(true);
            expect(reparsed.deviceInfo.baudRate10).to.equal(false);
        });

        it('should parse a VAR entry', function () {
            const obj = reparsed.objects[0x2000];
            expect(obj).to.exist;
            expect(obj.parameterName).to.equal('Read-only UINT32');
            expect(obj.objectType).to.equal(ObjectType.VAR);
            expect(obj.dataType).to.equal(DataType.UNSIGNED32);
            expect(obj.accessType).to.equal(AccessType.READ_ONLY);
        });

        it('should preserve defaultValue', function () {
            const obj = reparsed.objects[0x2000];
            expect(obj.defaultValue).to.equal('0xFF');
        });

        it('should parse an ARRAY with sub-objects', function () {
            const obj = reparsed.objects[0x2010];
            expect(obj).to.exist;
            expect(obj.objectType).to.equal(ObjectType.ARRAY);
            expect(obj.subObjects[1].dataType).to.equal(DataType.UNSIGNED16);
            expect(obj.subObjects[3].dataType).to.equal(DataType.UNSIGNED16);
        });

        it('should parse a RECORD with mixed sub-entry types', function () {
            const obj = reparsed.objects[0x2020];
            expect(obj).to.exist;
            expect(obj.objectType).to.equal(ObjectType.RECORD);
            expect(obj.subObjects[1].parameterName).to.equal('Field A');
            expect(obj.subObjects[1].dataType).to.equal(DataType.INTEGER32);
            expect(obj.subObjects[2].dataType).to.equal(DataType.REAL32);
        });

        it('should return date strings for dates', function () {
            expect(reparsed.fileInfo.creationDate).to.be.a('string');
            expect(reparsed.fileInfo.modificationDate).to.be.a('string');
        });
    });

    describe('serializeXdd', function () {
        it('should return a string', function () {
            const xml = serializeXdd(buildTestModel());
            expect(xml).to.be.a('string');
        });

        it('should include the ISO15745ProfileContainer root element', function () {
            const xml = serializeXdd(buildTestModel());
            expect(xml).to.include('ISO15745ProfileContainer');
        });

        it('should include object index in hex', function () {
            const xml = serializeXdd(buildTestModel());
            expect(xml).to.include('index="2000"');
        });

        it('should honour outputFileName override', function () {
            const xml = serializeXdd(buildTestModel(), 'custom.xdd');
            expect(xml).to.include('fileName="custom.xdd"');
        });
    });

    describe('round-trip', function () {
        it('should preserve all VAR entries after serialize→parse', function () {
            const original = buildTestModel();
            const reparsed = parseXdd(serializeXdd(original));
            for (const index of [0x2000, 0x2001, 0x2002, 0x2003]) {
                expect(reparsed.objects[index]).to.exist;
                expect(reparsed.objects[index].parameterName).to.equal(original.objects[index].parameterName);
                expect(reparsed.objects[index].dataType).to.equal(original.objects[index].dataType);
            }
        });

        it('should preserve ARRAY sub-count after round-trip', function () {
            const reparsed = parseXdd(serializeXdd(buildTestModel()));
            const subs = reparsed.objects[0x2010].subObjects;
            expect(Object.keys(subs).length).to.equal(4); // sub0 + 3 elements
        });

        it('should preserve RECORD sub-count after round-trip', function () {
            const reparsed = parseXdd(serializeXdd(buildTestModel()));
            const subs = reparsed.objects[0x2020].subObjects;
            expect(Object.keys(subs).length).to.equal(4); // sub0 + 3 fields
        });

        it('should preserve baudRate booleans after round-trip', function () {
            const reparsed = parseXdd(serializeXdd(buildTestModel()));
            expect(reparsed.deviceInfo.baudRate250).to.equal(true);
            expect(reparsed.deviceInfo.baudRate500).to.equal(true);
        });

        it('should preserve vendorName after round-trip', function () {
            const reparsed = parseXdd(serializeXdd(buildTestModel()));
            expect(reparsed.deviceInfo.vendorName).to.equal('Test Vendor');
        });
    });
});
