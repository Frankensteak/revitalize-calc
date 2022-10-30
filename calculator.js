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
					overall: {ppm: 0, characters: {}}, 
					trash: {ppm: 0, characters:{}}, 
					boss: {ppm: 0, characters:{}}, 
					bosses: []};
	revitProcs.sort((a,b) => a.timestamp - b.timestamp)
	var eventsByFight = eventsByFightMap(revitProcs);
	for(var fightID in eventsByFight){
		var fight = fightsById[fightID];
		var fightRevitProcs = getRevitProcsForFight(eventsByFight[fightID])
		var revitProcByCharacterID = fightRevitProcs.characters;
		if(fight.boss != 0){
			result.boss.ppm += fightRevitProcs.procs / msToMinutes(times.bossFightTime)
			var name = fight.name + `${!fight.kill ? " (wipe)" : ""}`;
			var fightMs = fight.end_time - fight.start_time;
			var bossCharacters = {};
			for(var id in revitProcByCharacterID){
				if(!result.boss.characters[id]){
					result.boss.characters[id] = {ppm: 0, resources: 0};
				}
				var ppm = revitProcByCharacterID[id].procs / msToMinutes(fightMs)
				var resources = revitProcByCharacterID[id].resourceGain;
				result.boss.characters[id].ppm += ppm;
				result.boss.characters[id].resources += resources;
				bossCharacters[id] = {ppm, resources}
			}
			result.bosses.push({name, ppm, characters: bossCharacters})
		}
		else{
			result.trash.ppm += fightRevitProcs.procs / msToMinutes(times.trashFightTime)
			for(var id in revitProcByCharacterID){
				if(!result.overall.characters[id]){
					result.overall.characters[id] = {ppm: 0, resources: 0};
				}
				var ppm = revitProcByCharacterID[id].procs / msToMinutes(times.trashFightTime)
				var resources = revitProcByCharacterID[id].resourceGain;
				result.trash.characters[id].ppm += ppm;
				result.trash.characters[id].resources += resources;
			}
		}
		result.overall.ppm += fightPpm;
		for(var id in revitProcByCharacterID){
			var ppm = revitProcByCharacterID[id].procs / msToMinutes(times.overallFightTime)
			var resources = revitProcByCharacterID[id].resourceGain;
			result.overall.characters[id].ppm += ppm;
			result.overall.characters[id].resources += resources;
		}
	}
	return result
}

function getRevitProcsForFight(events){
	var result = {procs: events.length, characters: {}};
	var procPerCharacterMap = procEventsByTargetIDMap(events);
	for(var targetID in procPerCharacterMap){
		var targetProcs = procPerCharacterMap[targetID]
		var resourceGain = targetProcs.reduce((total,event) => {
				return total + event.resourceChange
			}, 0)
		result.characters[targetID] = {procs: targetProcs.length, resourceGain}
	}
	return result;
}

function clean(revitProcResults, charactersById){
    for(var revitProcResult of revitProcResults){
        for(var type in revitProcResult){
            if(type === "bosses"){
                for(var boss of revitProcResult[type]){
                    boss.total = trimValue(boss.total);
                    boss.characters = cleanCharacters(boss.characters, charactersById);
                }
            }
            else{
                revitProcResult[type].ppm = trimValue(revitProcResult[type].ppm);
                revitProcResult[type].characters = cleanCharacters(revitProcResult[type].characters, charactersById);
            }
        }
    }
    return revitProcResults;
}

function cleanCharacters(characters, charactersById){
    var result = [];
    for(var id in characters){
        var character = charactersById[id];
		if(!character){
			continue;
		}
        var name = `${character.name} (${character.type})`;
        var charObj = characters[id];
        var ppm = trimValue(charObj.ppm);
		var resources = `${charObj.resources} ${resourceType(character.type)}`
		result.push({name, ppm, resources});
    }
    result.sort((a,b) => b.ppm - a.ppm);
    return result;
}

function resourceType(type){
	var result = "";
	switch(type){
		case "DeathKnight":
			result = "runic power";
			break;
		case "Druid":
			result = "mixed resources (not split for druids yet)"
			break;
		case "Rogue":
			result = "energy";
			break;
		case "Warrior":
			result = "rage";
			break;
		default:
			result = "mana";
			break;
	}
	return result;
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