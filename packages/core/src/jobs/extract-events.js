const { clamp } = require('lodash');

const config = require('config');
const extractorV1 = require('@0x-event-extractor/extractor-v1');
const extractorV2 = require('@0x-event-extractor/extractor-v2');
const signale = require('signale');

const BlockRange = require('../model/block-range');
const Event = require('../model/event');
const getCurrentBlock = require('../ethereum/get-current-block');
const getLastProcessedBlock = require('../events/get-last-processed-block');

const extractEventsForProtocol = async (
  protocolVersion,
  fetchLogEntries,
  getEventData,
) => {
  const logger = signale.scope(`extract events v${protocolVersion}`);
  const currentBlock = await getCurrentBlock();
  const lastBlock = await getLastProcessedBlock(protocolVersion);
  const maxBlock = currentBlock - config.get('minConfirmations');
  const fromBlock = lastBlock + 1;
  const toBlock = clamp(fromBlock + config.get('maxChunkSize'), 1, maxBlock);

  logger.info(`current block is ${currentBlock}`);

  if (toBlock < fromBlock) {
    logger.info('no more blocks to process');
    return;
  }

  logger.time(`fetch events from block ${fromBlock} to block ${toBlock}`);
  const logEntries = await fetchLogEntries(fromBlock, toBlock);
  logger.timeEnd(`fetch events from block ${fromBlock} to block ${toBlock}`);

  const events = logEntries.map(logEntry => ({
    blockNumber: parseInt(logEntry.blockNumber, 10),
    data: getEventData(logEntry),
    logIndex: logEntry.logIndex,
    protocolVersion: 1,
    transactionHash: logEntry.transactionHash,
    type: logEntry.event,
  }));

  if (events.length === 0) {
    logger.info(
      `no events were found from block ${fromBlock} to block ${toBlock}`,
    );
  } else {
    logger.time(`persist ${events.length} events`);
    await Event.insertMany(events);
    logger.timeEnd(`persist ${events.length} events`);
  }

  await BlockRange.findOneAndUpdate(
    { fromBlock, protocolVersion, toBlock },
    {
      $set: {
        date: new Date(),
        events: events.length,
        fromBlock,
        protocolVersion,
        toBlock,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  );
};

const extractEvents = async () => {
  await extractEventsForProtocol(
    1,
    extractorV1.fetchLogEntries,
    extractorV1.getEventData,
  );
  await extractEventsForProtocol(
    2,
    extractorV2.fetchLogEntries,
    extractorV2.getEventData,
  );
};

module.exports = extractEvents;