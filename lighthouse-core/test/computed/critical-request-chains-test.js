/**
 * @license Copyright 2016 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const assert = require('assert').strict;
const CriticalRequestChains = require('../../computed/critical-request-chains.js');
const NetworkRequest = require('../../lib/network-request.js');
const createTestTrace = require('../create-test-trace.js');
const networkRecordsToDevtoolsLog = require('../network-records-to-devtools-log.js');

const HIGH = 'High';
const VERY_HIGH = 'VeryHigh';
const MEDIUM = 'Medium';
const LOW = 'Low';
const VERY_LOW = 'VeryLow';

async function createChainsFromMockRecords(prioritiesList, edges, setExtrasFn) {
  const networkRecords = prioritiesList.map((priority, index) => ({
    requestId: index.toString(),
    url: 'https://www.example.com/' + index,
    documentURL: 'https://www.example.com',
    resourceType: index === 0 ? 'Document' : 'Stylesheet',
    frameId: 1,
    finished: true,
    priority,
    initiator: {type: 'parser'},
    statusCode: 200,
    startTime: index,
    responseReceivedTime: index + 0.5,
    endTime: index + 1,
  }));

  // add mock initiator information
  edges.forEach(edge => {
    const initiatorRequest = networkRecords[edge[0]];
    networkRecords[edge[1]].initiator = {
      type: 'parser',
      url: initiatorRequest.url,
    };
  });

  if (setExtrasFn) setExtrasFn(networkRecords);

  const trace = createTestTrace({topLevelTasks: [{ts: 0}]});
  const URL = {finalUrl: networkRecords[0].documentURL};
  const devtoolsLog = networkRecordsToDevtoolsLog(networkRecords);

  const context = {computedCache: new Map()};
  const criticalChains = await CriticalRequestChains.request({URL, trace, devtoolsLog}, context);

  replaceChain(criticalChains, networkRecords);
  return {
    networkRecords,
    criticalChains,
  };
}

function replaceChain(chains, networkRecords) {
  Object.keys(chains).forEach(chainId => {
    const chain = chains[chainId];
    chain.request = networkRecords.find(record => record.requestId === chainId);
    replaceChain(chain.children, networkRecords);
  });
}

describe('CriticalRequestChain computed artifact', () => {
  it('returns correct data for chain from a devtoolsLog', async () => {
    function simplifyChain(chains) {
      Object.keys(chains).forEach(childId => {
        chains[childId].request = {url: chains[childId].request.url};
        simplifyChain(chains[childId].children || {});
      });
    }

    const trace = createTestTrace({topLevelTasks: [{ts: 0}]});
    const devtoolsLog = require('../fixtures/wikipedia-redirect.devtoolslog.json');
    const URL = {finalUrl: 'https://en.m.wikipedia.org/wiki/Main_Page'};

    const context = {computedCache: new Map()};
    const chains = await CriticalRequestChains.request({trace, devtoolsLog, URL}, context);
    simplifyChain(chains);

    expect(chains).toEqual({
      '33097.1': {
        request: {url: 'http://en.wikipedia.org/'},
        children: {
          '33097.1:redirect': {
            request: {url: 'https://en.wikipedia.org/'},
            children: {
              '33097.1:redirect:redirect': {
                request: {url: 'https://en.wikipedia.org/wiki/Main_Page'},
                children: {
                  '33097.1:redirect:redirect:redirect': {
                    request: {url: 'https://en.m.wikipedia.org/wiki/Main_Page'},
                    children: {
                      '33097.3': {
                        request: {
                          url:
                          'https://en.m.wikipedia.org/w/load.php?debug=false&lang=en&modules=mediawiki.ui.button%2Cicon%7Cskins.minerva.base.reset%2Cstyles%7Cskins.minerva.content.styles%7Cskins.minerva.icons.images%7Cskins.minerva.mainPage.styles%7Cskins.minerva.tablet.styles&only=styles&skin=minerva',
                        },
                        children: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('returns correct data for chain of four critical requests', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, MEDIUM, VERY_HIGH, HIGH],
      [[0, 1], [1, 2], [2, 3]]
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {
                  3: {
                    request: networkRecords[3],
                    children: {},
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('returns correct data for chain interleaved with non-critical requests', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [MEDIUM, HIGH, LOW, MEDIUM, HIGH, VERY_LOW],
      [[0, 1], [1, 2], [2, 3], [3, 4]]
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {},
          },
        },
      },
    });
  });

  it('prunes chains not connected to the root document', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH, HIGH, HIGH],
      [[0, 2], [1, 3]]
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          2: {
            request: networkRecords[2],
            children: {},
          },
        },
      },
    });
  });

  it('returns correct data for fork at non root', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH, HIGH, HIGH],
      [[0, 1], [1, 2], [1, 3]]
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {},
              },
              3: {
                request: networkRecords[3],
                children: {},
              },
            },
          },
        },
      },
    });
  });

  it('returns single chain list when only root document', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [VERY_HIGH, LOW],
      [[0, 1]]
    );
    assert.deepEqual(criticalChains, {0: {request: networkRecords[0], children: {}}});
  });

  it('returns correct data on a random big graph', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      Array(9).fill(HIGH),
      [[0, 1], [1, 2], [1, 3], [0, 4], [4, 5], [5, 7], [7, 8], [5, 6]]
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {},
              },
              3: {
                request: networkRecords[3],
                children: {},
              },
            },
          },
          4: {
            request: networkRecords[4],
            children: {
              5: {
                request: networkRecords[5],
                children: {
                  7: {
                    request: networkRecords[7],
                    children: {
                      8: {
                        request: networkRecords[8],
                        children: {},
                      },
                    },
                  },
                  6: {
                    request: networkRecords[6],
                    children: {},
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('handles redirects', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH, HIGH],
      [[0, 1]],
      networkRecords => {
        // Make a fake redirect. Network recorder *appends* `:redirect` on a redirected request.
        networkRecords[1].requestId = '1';
        networkRecords[1].resourceType = undefined;
        networkRecords[1].responseReceivedTime = 2;

        networkRecords[2].requestId = '1:redirect';
        networkRecords[2].url = 'https://example.com/redirected-stylesheet';
      }
    );

    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              '1:redirect': {
                request: networkRecords[2],
                children: {},
              },
            },
          },
        },
      },
    });
  });

  it('discards favicons as non-critical', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH, HIGH, HIGH],
      [[0, 1], [0, 2], [0, 3]],
      networkRecords => {
        // 2nd record is a favicon
        networkRecords[1].url = 'https://example.com/favicon.ico';
        networkRecords[1].mimeType = 'image/x-icon';
        // 3rd record is a favicon
        networkRecords[2].url = 'https://example.com/favicon-32x32.png';
        networkRecords[2].mimeType = 'image/png';
        // 4th record is a favicon
        networkRecords[3].url = 'https://example.com/android-chrome-192x192.png';
        networkRecords[3].mimeType = 'image/png';
      }
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
    });
  });

  it('discards iframes as non-critical', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH, HIGH, HIGH, HIGH],
      [[0, 1], [0, 2], [0, 3]],
      networkRecords => {
        // 1st record is the root document
        networkRecords[0].url = 'https://example.com';
        networkRecords[0].mimeType = 'text/html';
        networkRecords[0].resourceType = NetworkRequest.TYPES.Document;
        // 2nd record is an iframe in the page
        networkRecords[1].url = 'https://example.com/iframe.html';
        networkRecords[1].mimeType = 'text/html';
        networkRecords[1].resourceType = NetworkRequest.TYPES.Document;
        networkRecords[1].frameId = '2';
        // 3rd record is an iframe loaded by a script
        networkRecords[2].url = 'https://youtube.com/';
        networkRecords[2].mimeType = 'text/html';
        networkRecords[2].resourceType = NetworkRequest.TYPES.Document;
        networkRecords[2].frameId = '3';
        // 4th record is an iframe in the page that redirects, see https://github.com/GoogleChrome/lighthouse/issues/6675.
        networkRecords[3].requestId = '3';
        networkRecords[3].url = 'https://example.com/redirect-iframe-src';
        networkRecords[3].resourceType = undefined;
        networkRecords[3].frameId = '4';
        networkRecords[3].responseReceivedTime = 4;
        // 5th record is an iframe in the page that was redirect destination.
        networkRecords[4].requestId = '3:redirect';
        networkRecords[4].url = 'https://example.com/redirect-iframe-dest';
        networkRecords[4].resourceType = NetworkRequest.TYPES.Document;
        networkRecords[4].frameId = '4';
      }
    );

    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
    });
  });

  it('handles non-existent nodes when building the tree', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH],
      [[0, 1]],
      networkRecords => {
        // Reverse the records so we force nodes to be made early.
        networkRecords.reverse();
      }
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[1],
        children: {
          1: {
            request: networkRecords[0],
            children: {},
          },
        },
      },
    });
  });

  it('returns correct data for chain with preload', async () => {
    const {networkRecords, criticalChains} = await createChainsFromMockRecords(
      [HIGH, HIGH],
      [[0, 1]],
      networkRecords => {
        networkRecords[1].isLinkPreload = true;
      }
    );
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
    });
  });
});
