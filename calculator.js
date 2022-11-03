const https = require('https');

const CACHE = {};

function calculate(apiKey, logId){
	var cachedResult = CACHE[logId];
	if(cachedResult){
		return new Promise(resolve => resolve(cachedResult));
	}
	return get(apiKey, logId, "fights").then(fightsJSON => {
		var fights = fightsJSON['fights'];
		var fightsById = fightsByIDMap(fights);
		var times = getTimes(fights);
		return get(apiKey, logId, "tables", "summary", {end: times["endTime"]}).then(summaryJSON => {
			var characters = summaryJSON["composition"];
			var charactersById = charactersByIDMap(characters);
			return getRevitProcs(apiKey, logId, times).then(revitProcs => {
				var processedRevits = process(revitProcs, fightsById, times);
				var result = clean(processedRevits, charactersById);
				CACHE[logId] = result;
				return result;
			})
		});
	});
}

function process(revitProcs, fightsById, times){
	var result = {name: "All Druids", 
					overall: {ppm: 0, procs: 0, resources: {}, characters: {}}, 
					trash: {ppm: 0, procs: 0, resources: {}, characters: {}}, 
					boss: {ppm: 0, procs: 0, resources: {}, characters: {}}, 
					bosses: []};
	revitProcs.sort((a,b) => a.timestamp - b.timestamp)
	var eventsByFight = eventsByFightMap(revitProcs);
	console.log(JSON.stringify(times));
	for(var fightID in eventsByFight){
		var fight = fightsById[fightID];
		var fightRevitProcs = getRevitProcsForFight(eventsByFight[fightID])
		var revitProcByCharacterID = fightRevitProcs.characters;
		if(fight.boss != 0){
			var fightProcs = fightRevitProcs.procs
			var fightPpm = fightProcs / msToMinutes(times.bossFightTime)
			var fightResources = fightRevitProcs.resources
			result.boss.procs += fightProcs
			result.boss.ppm += fightPpm
			result.boss.resources = addResources(result.boss.resources, fightResources);
			var name = fight.name + `${!fight.kill ? " (wipe)" : ""}`;
			var fightMs = fight.end_time - fight.start_time;
			var bossCharacters = {};
			for(var id in revitProcByCharacterID){
				if(!result.boss.characters[id]){
					result.boss.characters[id] = {procs: 0, ppm: 0, resources: {}};
				}
				var procs = revitProcByCharacterID[id].procs
				var ppm = procs / msToMinutes(fightMs)
				var resources = revitProcByCharacterID[id].resources;
				addTimingToResources(resources, msToSeconds(fightMs))
				result.boss.characters[id].procs += procs;
				result.boss.characters[id].ppm += ppm;
				result.boss.characters[id].resources = addResources(result.boss.characters[id].resources, resources);
				bossCharacters[id] = {ppm, procs, resources}
			}
			result.bosses.push({name, procs: fightProcs, ppm: fightProcs / msToMinutes(fightMs), resources: fightResources, characters: bossCharacters})
		}
		else{
			result.trash.procs += fightRevitProcs.procs
			result.trash.ppm += fightRevitProcs.procs / msToMinutes(times.trashFightTime)
			result.trash.resources = addResources(result.trash.resources, fightRevitProcs.resources);
			var fightResources = fightRevitProcs.resources
			for(var id in revitProcByCharacterID){
				if(!result.trash.characters[id]){
					result.trash.characters[id] = {procs: 0, ppm: 0, resources: {}};
				}
				var procs = revitProcByCharacterID[id].procs
				var ppm = procs / msToMinutes(times.trashFightTime)
				var resources = revitProcByCharacterID[id].resources;
				addTimingToResources(resources, msToSeconds(fightMs))
				result.trash.characters[id].procs += procs;
				result.trash.characters[id].ppm += ppm;
				result.trash.characters[id].resources = addResources(result.trash.characters[id].resources, resources);
			}
		}
		result.overall.procs += fightRevitProcs.procs
		result.overall.ppm += fightRevitProcs.procs / msToMinutes(times.overallFightTime);
		result.overall.resources = addResources(result.overall.resources, fightRevitProcs.resources);
		for(var id in revitProcByCharacterID){
			if(!result.overall.characters[id]){
				result.overall.characters[id] = {procs: 0, ppm: 0, resources: {}};
			}
			var procs = revitProcByCharacterID[id].procs
			var ppm = procs / msToMinutes(times.overallFightTime)
			var resources = revitProcByCharacterID[id].resources;
			addTimingToResources(resources, msToSeconds(fightMs))
			result.overall.characters[id].procs += procs;
			result.overall.characters[id].ppm += ppm;
			result.overall.characters[id].resources = addResources(result.overall.characters[id].resources, resources);
		}
	}
	return result
}

function addTimingToResources(resources, seconds){
	for(var resource in resources){
		switch(resource){
			case "mana":
				resources["mp5"] = Math.round((resources[resource] / (seconds * 5)) * 10) / 10
				break;
			case "energy":
				resources["eps"] = Math.round((resources[resource] / seconds) * 10) / 10
				break;
			case "rage":
				resources["rps"] = Math.round((resources[resource] / seconds) * 10) / 10
				break;
			case "runic power":
				resources["rpps"] = Math.round((resources[resource] / seconds) * 10) / 10
				break;
		}
	}
}

function addResources(source, newResources){
	for(var resource in newResources){
		if(!source[resource]){
			source[resource] = 0
		}
		source[resource] += newResources[resource];
	}
	return source;
}

function getRevitProcsForFight(events){
	var result = {procs: events.length, resources: {}, characters: {}};
	var procPerCharacterMap = procEventsByTargetIDMap(events);
	for(var targetID in procPerCharacterMap){
		var targetProcs = procPerCharacterMap[targetID]
		var resources = {};
		for(var proc of targetProcs){
			var resourceType = "undefined";
			switch(proc.resourceChangeType){
				case 0:
					resourceType = "mana";
					break;
				case 1:
					resourceType = "rage";
					break;
				case 3:
					resourceType = "energy";
					break;
				case 6:
					resourceType = "runic power";
					break;
			}
			if(!resources[resourceType]){
				resources[resourceType] = 0
			}
			resources[resourceType] += proc.resourceChange
			if(!result.resources[resourceType]){
				result.resources[resourceType] = 0
			}
			result.resources[resourceType] += proc.resourceChange
		}
		result.characters[targetID] = {procs: targetProcs.length, resources}
	}
	return result;
}

function clean(revitProcResult, charactersById){
	for(var type in revitProcResult){
		if(type === "name"){
			//Do nothing
		}
		else if(type === "bosses"){
			for(var boss of revitProcResult[type]){
				boss.ppm = trimValue(boss.ppm);
				boss.procs = boss.procs.toLocaleString()
				boss.resources = cleanResources(boss.resources);
				boss.characters = cleanCharacters(boss.characters, charactersById);
			}
		}
		else{
			revitProcResult[type].ppm = trimValue(revitProcResult[type].ppm);
			revitProcResult[type].procs = revitProcResult[type].procs.toLocaleString();
			revitProcResult[type].resources = cleanResources(revitProcResult[type].resources);
			revitProcResult[type].characters = cleanCharacters(revitProcResult[type].characters, charactersById);
		}
	}
    return revitProcResult;
}

function cleanCharacters(characters, charactersById){
    var result = [];
    for(var id in characters){
        var character = charactersById[id];
		var name = "";
		if(!character){
			name = `Unknown Pet (ID: ${id})`;
		}
		else{
			var name = `${character.name} (${character.type})`;
		}
        var charObj = characters[id];
		var procs = charObj.procs
        var ppm = trimValue(charObj.ppm);
		var resources = cleanResources(charObj.resources)
		result.push({name, procs, ppm, resources});
    }
    result.sort((a,b) => b.ppm - a.ppm);
    return result;
}

function cleanResources(resources){
	var resourceArray = []
	for(var resource in resources){
		resourceArray.push(`${resources[resource].toLocaleString()} ${resource}`)
	}
	return resourceArray.join(', ');
}
	
function getRevitProcs(apiKey, logId, times){
	var promises = []
	var energyPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 103, filter: "ability.id%3D48540"}).then(response => {
		return response.events;
	});
	promises.push(energyPromise);
	var ragePromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 101, filter: "ability.id%3D48541"}).then(response => {
		return response.events;
	});
	promises.push(ragePromise);
	var manaPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 100, filter: "ability.id%3D48542"}).then(response => {
		return response.events;
	});
	promises.push(manaPromise);
	var runicPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 106, filter: "ability.id%3D48543"}).then(response => {
		return response.events;
	});
	promises.push(runicPromise);
	return Promise.all(promises).then(responses => {
		var result = [];
		for(var response of responses){
			result = result.concat(response)
		}
		return result;
	})
}

function getTimes(fights){
	var endTime = fights[fights.length - 1].end_time;
	var overallFightTime = 0;
	var bossFightTime = 0;
	var trashFightTime = 0;
	fights.forEach(fight => {
		var fightLength = fight.end_time - fight.start_time;
		overallFightTime += fightLength;
		if(fight.boss === 0){
			trashFightTime += fightLength;
		}
		else{
			bossFightTime += fightLength
		}
	});
	return { endTime, overallFightTime, bossFightTime, trashFightTime };
}
	
function get(apiKey, logId, view, metric, properties){
	var query = `?api_key=${apiKey}`;
	for(var key in properties){
		query += `&${key}=${properties[key]}`;
	}
	var viewPath = view ? `${view}/` : "";
	var metricPath = metric ? `${metric}/` : "";
	var url = 'https://classic.warcraftlogs.com/v1/report/' + viewPath + metricPath + logId + query;
	return new Promise((resolve,reject) => {
		https.get(url, res => {
			var body = [];
			res.on('data', d => {
				body.push(d);
			});
			res.on('end', () => {
				try{
					body = JSON.parse(Buffer.concat(body).toString());
				} catch(e){
					reject(e);
				}
				if(body.nextPageTimestamp){
					var innerProperties = JSON.parse(JSON.stringify(properties));
					innerProperties.start = body.nextPageTimestamp;
					get(apiKey, logId, view, metric, innerProperties).then(innerResponse => {
						body.events = body.events.concat(innerResponse.events);
						body.count += innerResponse.count;
						resolve(body);
					})
				}
				else{
					resolve(body);
				}
			})
		}).on('error', e => {
			reject(e);
		})
	});
}

function fightsByIDMap(fights){
	return fights.reduce((map, fight) => {
		if(!map[fight.id]){
			map[fight.id] = fight;
		}
		return map
	}, {});
}

function charactersByIDMap(characters){
	return characters.reduce((map, character) => {
		map[character.id] = character;
		return map;
	}, {});
}

function procEventsByTargetIDMap(events){
	return events.reduce((map, event) => {
		if(!event["targetIsFriendly"]){return map;}
		var target = event["targetID"]
		if(!map[target]){
			map[target] = [];
		}
		map[target].push(event);
		return map;
	}, {});
}

function eventsByFightMap(events){
	return events.reduce((map, event) => {
		if(!map[event.fight]){
			map[event.fight] = []
		}
		map[event.fight].push(event);
		return map;
	}, {});
}

function msToSeconds(ms){
	return ms / 1000;
}

function msToMinutes(ms){
	return msToSeconds(ms) / 60;
}

function trimValue(value){
    return Math.round(value * 10) / 10;
}

module.exports = {
    calculate
}

/*
-revitProcResults array[Event]
-48540(energy) = resourceChangeType 3
-48541(rage) = resourceChangeType 1
-48542(mana) = resourceChangeType 0
-48543(runic) = resourceChangeType 6

-Event: {
-  timestamp: 1610033,
-  type: 'resourcechange',
-  sourceID: 4,
-  sourceIsFriendly: true,
-  targetID: 4,
-  targetIsFriendly: true,
-  ability: {
-    name: 'Revitalize',
-    guid: 48540,
-    type: 8,
-    abilityIcon: 'ability_druid_replenish.jpg'
-  },
-  fight: 19,
-  pin: '0',
-  resourceChange: 8,
-  resourceChangeType: 3,
-  otherResourceChange: 0,
-  maxResourceAmount: 100,
-  waste: 0,
-  resourceActor: 1,
-  classResources: [ { amount: 78, max: 100, type: 3 } ],
-  hitPoints: 100,
-  maxHitPoints: 100,
-  attackPower: 6106,
        });
 }
-/*
-revitProcResults array[Event]
-48540(energy) = resourceChangeType 3
-48541(rage) = resourceChangeType 1
-48542(mana) = resourceChangeType 2
-48543(runic) = resourceChangeType 6

-Event: {
-  timestamp: 1610033,
-  type: 'resourcechange',
-  sourceID: 4,
-  sourceIsFriendly: true,
-  targetID: 4,
-  targetIsFriendly: true,
-  ability: {
-    name: 'Revitalize',
-    guid: 48540,
-    type: 8,
-    abilityIcon: 'ability_druid_replenish.jpg'
-  },
-  fight: 19,
-  pin: '0',
-  resourceChange: 8,
-  resourceChangeType: 3,
-  otherResourceChange: 0,
-  maxResourceAmount: 100,
-  waste: 0,
-  resourceActor: 1,
-  classResources: [ { amount: 78, max: 100, type: 3 } ],
-  hitPoints: 100,
-  maxHitPoints: 100,
-  attackPower: 6106,
-  spellPower: 367,
-  armor: 8680,
-  x: 305467,
-  y: 337794,
-  facing: -276,
-  mapID: 162,
-  itemLevel: 203
-}
-*/