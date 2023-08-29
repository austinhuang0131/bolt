import { Bolt } from '../bolt.ts';
import { createBoltMessage, logBoltError } from '../utils.ts';
import {
	BoltBridgeDocument,
	BoltBridgePlatform,
	BoltBridgeSentPlatform
} from './types.ts';

export async function getBoltBridgedMessage(bolt: Bolt, id?: string) {
	return JSON.parse((await bolt.redis?.get(`message-${id}`)) || 'false') as
		| BoltBridgeSentPlatform[]
		| false;
}

export async function getBoltBridge(
	bolt: Bolt,
	{ channel, _id }: { channel?: string; _id?: string }
) {
	let query;
	if (channel) {
		query = { 'platforms.channel': channel };
	} else if (_id) {
		query = { _id };
	} else {
		throw new Error('Must provide one of channel or _id');
	}
	return await bolt.mongo
		.database(bolt.database)
		.collection<BoltBridgeDocument>('bridges')
		.findOne(query);
}

export async function updateBoltBridge(bolt: Bolt, bridge: BoltBridgeDocument) {
	return await bolt.mongo
		.database(bolt.database)
		.collection<BoltBridgeDocument>('bridges')
		.replaceOne({ _id: bridge._id }, bridge, { upsert: true });
}

export async function joinBoltBridge(
	bolt: Bolt,
	channel: string,
	platform: string,
	name?: string
) {
	const current = await getBoltBridge(bolt, { channel });
	if (current?._id) {
		return {
			message: createBoltMessage({
				content:
					"To run this command you can't be in a bridge. To learn more, run `!bolt help`."
			}),
			code: 'InBridge'
		};
	}
	if (!name) {
		return {
			message: createBoltMessage({
				content:
					'Please provide a name for your bridge. To learn more, run `!bolt help`.'
			}),
			code: 'MissingParameter'
		};
	}
	const plugin = bolt.getPlugin(platform);
	if (!plugin?.createSenddata) {
		return logBoltError(bolt, {
			message: `Can't find plugin while creating bridge`,
			code: 'BridgeCreationNoPlugin',
			extra: { plugin, channel, platform, name, current }
		});
	}
	const bridge = (await getBoltBridge(bolt, { _id: name })) || {
		_id: `bridge-${name}`,
		name,
		platforms: []
	};
	try {
		const senddata = await plugin.createSenddata(channel);
		bridge.platforms.push({
			channel,
			plugin: platform,
			senddata
		});
		await updateBoltBridge(bolt, bridge);
	} catch (e) {
		return logBoltError(bolt, {
			message: `Can't update this bridge`,
			cause: e,
			code: 'BridgeCreationCreateUpdateFailed',
			extra: { plugin, channel, platform, name, current }
		});
	}
	return {
		message: createBoltMessage({
			content: 'Joined a bridge!'
		}),
		code: 'OK'
	};
}

export async function leaveBoltBridge(
	bolt: Bolt,
	channel: string,
	platform: string
) {
	const current = await getBoltBridge(bolt, { channel });
	if (!current?._id) {
		return {
			message: createBoltMessage({
				content:
					'To run this command you need to be in a bridge. To learn more, run `!bolt help`.'
			}),
			code: 'NotInBridge',
			e: false
		};
	}
	try {
		await updateBoltBridge(bolt, {
			...current,
			platforms: current.platforms.filter(
				(i: BoltBridgePlatform) =>
					i.channel === channel && i.plugin === platform
			)
		});
	} catch (e) {
		return logBoltError(bolt, {
			cause: e,
			message: `Can't leave that bridge`,
			code: 'BridgeCreationLeaveFailed',
			extra: { channel, platform, current }
		});
	}
	return {
		message: createBoltMessage({ content: 'Left a bridge!' }),
		code: 'OK',
		e: false
	};
}

export async function resetBoltBridge(
	bolt: Bolt,
	channel: string,
	platform: string,
	name?: string
) {
	const current = await getBoltBridge(bolt, { channel });
	if (current?._id) {
		const result = await leaveBoltBridge(bolt, channel, platform);
		if (result.code !== 'OK') return result.message;
	}
	const result = await joinBoltBridge(
		bolt,
		channel,
		platform,
		name || current?._id.substring(6)
	);
	if (result.code !== 'OK') return result.message;
	return createBoltMessage({ content: 'Reset this bridge!' });
}
