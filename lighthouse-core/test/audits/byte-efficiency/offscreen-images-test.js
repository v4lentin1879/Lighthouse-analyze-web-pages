/**
 * @license Copyright 2017 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const UnusedImages =
    require('../../../audits/byte-efficiency/offscreen-images.js');
const assert = require('assert').strict;
const createTestTrace = require('../../create-test-trace.js');
const networkRecordsToDevtoolsLog = require('../../network-records-to-devtools-log.js');

/* eslint-env jest */
function generateRecord({
  resourceSizeInKb,
  url = 'https://google.com/logo.png',
  startTime = 0,
  mimeType = 'image/png',
}) {
  return {
    url,
    mimeType,
    startTime, // DevTools timestamp which is in seconds.
    resourceSize: resourceSizeInKb * 1024,
    transferSize: resourceSizeInKb * 1024,
  };
}

function generateSize(width, height, prefix = 'displayed') {
  const size = {};
  size[`${prefix}Width`] = width;
  size[`${prefix}Height`] = height;
  return size;
}

function generateImage({
  size,
  x,
  y,
  networkRecord,
  loading,
  src = 'https://google.com/logo.png',
}) {
  Object.assign(networkRecord || {}, {url: src});

  const clientRect = {
    top: y,
    bottom: y + size.displayedHeight,
    left: x,
    right: x + size.displayedWidth,
  };

  return {
    src,
    clientRect,
    loading,
    ...networkRecord,
    ...size,
  };
}

describe('OffscreenImages audit', () => {
  let context;
  const DEFAULT_DIMENSIONS = {innerWidth: 1920, innerHeight: 1080};

  beforeEach(() => {
    context = {settings: {throttlingMethod: 'devtools'}, computedCache: new Map()};
  });

  it('handles images without network record', () => {
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({size: generateSize(100, 100), x: 0, y: 0}),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, [], context).then(auditResult => {
      assert.equal(auditResult.items.length, 0);
    });
  });

  it('does not find used images', async () => {
    const urlB = 'https://google.com/logo2.png';
    const urlC = 'data:image/jpeg;base64,foobar';
    const recordA = generateRecord({resourceSizeInKb: 100});
    const recordB = generateRecord({url: urlB, resourceSizeInKb: 100});
    const recordC = generateRecord({url: urlC, resourceSizeInKb: 3});
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({
          size: generateSize(200, 200),
          x: 0,
          y: 0,
          networkRecord: recordA,
        }),
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: 1080,
          networkRecord: recordB,
          src: urlB,
        }),
        generateImage({
          size: generateSize(400, 400),
          x: 1720,
          y: 1080,
          networkRecord: recordC,
          src: urlC,
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    const auditResult = await UnusedImages.audit_(artifacts, [recordA, recordB, recordC], context);
    assert.equal(auditResult.items.length, 0);
  });

  it('finds unused images', async () => {
    const url = s => `https://google.com/logo${s}.png`;
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecords = [
      generateRecord({url: url('A'), resourceSizeInKb: 100}),
      generateRecord({url: url('B'), resourceSizeInKb: 100}),
      generateRecord({url: url('C'), resourceSizeInKb: 100}),
      generateRecord({url: url('D'), resourceSizeInKb: 100}),
      generateRecord({url: url('E'), resourceSizeInKb: 100}),
      generateRecord({url: url('F'), resourceSizeInKb: 100}),
      generateRecord({url: url('G'), resourceSizeInKb: 100}),
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the right.
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: networkRecords[0],
          src: url('A'),
        }),
        // Waaay offscreen to the bottom
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: 5000,
          networkRecord: networkRecords[1],
          src: url('B'),
        }),
        // Offscreen to the top.
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: -400,
          networkRecord: networkRecords[2],
          src: url('C'),
        }),
        // Offscreen to the top-left.
        generateImage({
          size: generateSize(100, 100),
          x: -2000,
          y: -1000,
          networkRecord: networkRecords[3],
          src: url('D'),
        }),
        // Offscreen to the bottom-right.
        generateImage({
          size: generateSize(100, 100),
          x: 3000,
          y: 2000,
          networkRecord: networkRecords[4],
          src: url('E'),
        }),
        // Half offscreen to the top, should not warn.
        generateImage({
          size: generateSize(1000, 1000),
          x: 0,
          y: -500,
          networkRecord: networkRecords[5],
          src: url('F'),
        }),
        // Offscreen to the bottom but within 3 viewports, should not warn
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: 2000,
          networkRecord: networkRecords[6],
          src: url('G'),
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    const auditResult = await UnusedImages.audit_(artifacts, networkRecords, context);
    expect(auditResult.items).toMatchObject([
      {url: url('A')},
      {url: url('B')},
      {url: url('C')},
      {url: url('D')},
      {url: url('E')},
    ]);
  });

  it('passes images with a specified loading attribute', async () => {
    const url = s => `https://google.com/logo${s}.png`;
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecords = [
      generateRecord({url: url('A'), resourceSizeInKb: 100}),
      generateRecord({url: url('B'), resourceSizeInKb: 100}),
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the right, but lazy loaded.
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: networkRecords[0],
          loading: 'lazy',
          src: url('A'),
        }),
        // Offscreen to the bottom, but eager loaded.
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: 5000,
          networkRecord: networkRecords[1],
          loading: 'eager',
          src: url('B'),
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, networkRecords, context).then(auditResult => {
      assert.equal(auditResult.items.length, 0);
    });
  });

  it('fails images with an unspecified or arbitrary loading attribute', async () => {
    const url = s => `https://google.com/logo${s}.png`;
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecords = [
      generateRecord({url: url('A'), resourceSizeInKb: 100}),
      generateRecord({url: url('B'), resourceSizeInKb: 100}),
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the right with auto loading (same as not specifying the attribute).
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: networkRecords[0],
          loading: 'auto',
          src: url('A'),
        }),
        // Offscreen to the bottom, with an arbitrary loading attribute.
        generateImage({
          size: generateSize(100, 100),
          x: 0,
          y: 5000,
          networkRecord: networkRecords[1],
          loading: 'imagination',
          src: url('B'),
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, networkRecords, context).then(auditResult => {
      assert.equal(auditResult.items.length, 2);
    });
  });

  it('finds images with 0 area', () => {
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecord = generateRecord({resourceSizeInKb: 100});
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({size: generateSize(0, 0), x: 0, y: 0, networkRecord}),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, [networkRecord], context).then(auditResult => {
      assert.equal(auditResult.items.length, 1);
      assert.equal(auditResult.items[0].wastedBytes, 100 * 1024);
    });
  });

  it('de-dupes images', () => {
    const urlB = 'https://google.com/logo2.png';
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecords = [
      generateRecord({resourceSizeInKb: 50}),
      generateRecord({resourceSizeInKb: 50}),
      generateRecord({url: urlB, resourceSizeInKb: 200}),
      generateRecord({url: urlB, resourceSizeInKb: 90}),
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({
          size: generateSize(50, 50),
          x: 0,
          y: 0,
          networkRecord: networkRecords[0],
        }),
        generateImage({
          size: generateSize(1000, 1000),
          x: 1000,
          y: 1000,
          networkRecord: networkRecords[1],
        }),
        generateImage({
          size: generateSize(50, 50),
          x: 0,
          y: 5000,
          networkRecord: networkRecords[2],
          src: urlB,
        }),
        generateImage({
          size: generateSize(400, 400),
          x: 0,
          y: 5000,
          networkRecord: networkRecords[3],
          src: urlB,
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, networkRecords, context).then(auditResult => {
      assert.equal(auditResult.items.length, 1);
    });
  });

  it('disregards images loaded after TTI', () => {
    const topLevelTasks = [{ts: 1900, duration: 100}];
    const networkRecord = generateRecord({resourceSizeInKb: 100, startTime: 3});
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the right.
        generateImage({size: generateSize(200, 200), x: 3000, y: 0, networkRecord}),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, [networkRecord], context).then(auditResult => {
      assert.equal(auditResult.items.length, 0);
    });
  });

  it('disregards images loaded after Trace End when interactive throws error', () => {
    const networkRecord = generateRecord({resourceSizeInKb: 100, startTime: 3});
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the right.
        generateImage({size: generateSize(200, 200), x: 3000, y: 0, networkRecord}),
      ],
      traces: {defaultPass: createTestTrace({traceEnd: 2000})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, [networkRecord], context).then(auditResult => {
      assert.equal(auditResult.items.length, 0);
    });
  });

  it('finds images loaded before Trace End when TTI when interactive throws error', () => {
    const networkRecord = generateRecord({resourceSizeInKb: 100});
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        // Offscreen to the bottom.
        generateImage({size: generateSize(100, 100), x: 0, y: 5000, networkRecord}),
      ],
      traces: {defaultPass: createTestTrace({traceEnd: 2000})},
      devtoolsLogs: {},
    };

    return UnusedImages.audit_(artifacts, [networkRecord], context).then(auditResult => {
      assert.equal(auditResult.items.length, 1);
    });
  });

  it('disregards images loaded after last long task (Lantern)', () => {
    context = {settings: {throttlingMethod: 'simulate'}, computedCache: new Map()};
    const wastedSize = 100 * 1024;
    const recordA = {
      url: 'https://example.com/a',
      resourceSize: wastedSize,
      transferSize: wastedSize,
      requestId: 'a',
      startTime: 1,
      priority: 'High',
      timing: {receiveHeadersEnd: 1.25},
    };
    const recordB = {
      url: 'https://example.com/b',
      resourceSize: wastedSize,
      transferSize: wastedSize,
      requestId: 'b',
      startTime: 2.25,
      priority: 'High',
      timing: {receiveHeadersEnd: 2.5},
    };
    const devtoolsLog = networkRecordsToDevtoolsLog([recordA, recordB]);

    const topLevelTasks = [
      {ts: 1975, duration: 50},
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({
          size: generateSize(0, 0),
          x: 0,
          y: 0,
          networkRecord: recordA,
          src: recordA.url,
        }),
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: recordB,
          src: recordB.url,
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {defaultPass: devtoolsLog},
    };

    return UnusedImages.audit_(artifacts, [recordA, recordB], context).then(auditResult => {
      assert.equal(auditResult.items.length, 1);
      assert.equal(auditResult.items[0].url, recordA.url);
      assert.equal(auditResult.items[0].wastedBytes, wastedSize);
    });
  });

  it('finds images loaded before last long task (Lantern)', () => {
    context = {settings: {throttlingMethod: 'simulate'}, computedCache: new Map()};
    const wastedSize = 100 * 1024;
    const recordA = {
      url: 'https://example.com/a',
      resourceSize: wastedSize,
      transferSize: wastedSize,
      requestId: 'a',
      startTime: 1,
      priority: 'High',
      timing: {receiveHeadersEnd: 1.25},
    };
    const recordB = {
      url: 'https://example.com/b',
      resourceSize: wastedSize,
      transferSize: wastedSize,
      requestId: 'b',
      startTime: 1.25,
      priority: 'High',
      timing: {receiveHeadersEnd: 1.5},
    };
    const devtoolsLog = networkRecordsToDevtoolsLog([recordA, recordB]);

    // Enough tasks to spread out graph.
    const topLevelTasks = [
      {ts: 1000, duration: 10},
      {ts: 1050, duration: 10},
      {ts: 1975, duration: 50},
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({
          size: generateSize(0, 0),
          x: 0,
          y: 0,
          networkRecord: recordA,
          src: recordA.url,
        }),
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: recordB,
          src: recordB.url,
        }),
      ],
      traces: {defaultPass: createTestTrace({topLevelTasks})},
      devtoolsLogs: {defaultPass: devtoolsLog},
    };

    return UnusedImages.audit_(artifacts, [recordA, recordB], context).then(auditResult => {
      assert.equal(auditResult.items.length, 2);
      assert.equal(auditResult.items[0].url, recordA.url);
      assert.equal(auditResult.items[0].wastedBytes, wastedSize);
      assert.equal(auditResult.items[1].url, recordB.url);
      assert.equal(auditResult.items[1].wastedBytes, wastedSize);
    });
  });

  it('rethrow error when interactive throws error in Lantern', async () => {
    context = {settings: {throttlingMethod: 'simulate'}, computedCache: new Map()};
    const networkRecords = [
      generateRecord({url: 'a', resourceSizeInKb: 100, startTime: 3}),
      generateRecord({url: 'b', resourceSizeInKb: 100, startTime: 4}),
    ];
    const artifacts = {
      ViewportDimensions: DEFAULT_DIMENSIONS,
      ImageElements: [
        generateImage({
          size: generateSize(0, 0),
          x: 0,
          y: 0,
          networkRecord: networkRecords[0],
          src: 'a',
        }),
        generateImage({
          size: generateSize(200, 200),
          x: 3000,
          y: 0,
          networkRecord: networkRecords[1],
          src: 'b',
        }),
      ],
      traces: {defaultPass: createTestTrace({traceEnd: 2000})},
      devtoolsLogs: {},
    };

    try {
      await UnusedImages.audit_(artifacts, networkRecords, context);
    } catch (err) {
      assert.ok(err.message.includes('Did not provide necessary metric computation data'));
      return;
    }
    assert.ok(false);
  });
});
