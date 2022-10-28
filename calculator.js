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
			var restos = filterCharacters(characters, {"type":"Druid", "role":"healer"})
			var revitProcPromises = [];
			return getRevitProcs(apiKey, logId, times, fightsById, restos, characters).then(revitProcs => {
				var result = process(revitProcs);
				CACHE[logId] = result;
				return result;
			})
			for(var character of restos){
				var revitProcPromise = getRevitProcs(apiKey, logId, times, fightsById, character);
				revitProcPromises.push(revitProcPromise);
			}
			return Promise.all(revitProcPromises).then(revitProcResults => {
				var result = clean(revitProcResults, charactersById)
				CACHE[logId] = result;
				return result;
			});
		});
	});
}

function process(revitProcs){
	//TODO: PROC$SS EM
}

//TODO: Update to revit procs
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
                revitProcResult[type].total = trimValue(revitProcResult[type].total);
                revitProcResult[type].characters = cleanCharacters(revitProcResult[type].characters, charactersById);
            }
        }
    }
    return revitProcResults;
}

//TODO: Update to use character class
function cleanCharacters(characters, charactersById){
    var result = [];
    for(var id in characters){
        var character = charactersById[id];
		if(!character){
			continue;
		}
        var name = `${character.name} (${determineRoles(character.specs)})`;
        var charObj = characters[id];
        var percent = trimPercent(charObj.uptime);
        if(percent > 0){
            result.push({name, uptime: percent, drops: charObj.drops});
        }
    }
    result.sort((a,b) => b.uptime - a.uptime);
    return result;
}
	
function getRevitProcs(apiKey, logId, times, fightsById, restos, characters){
	//https://classic.warcraftlogs.com/v1/report/events/resources/nrBC71TjLzgAMHxq?api_key=98bcbe95946948df07168857bfce2f29&abilityid=100&end=9999999999
	//Update api calls
	return get(apiKey, logId, "events", "buffs", {end: times.endTime, "abilityid": 33763, "sourceid": character.id}).then(buffsJSON => {
		var result = {name: character.name, 
					  overall: {total: 0, characters: {}}, 
					  trash: {total: 0, characters:{}}, 
					  boss: {total: 0, characters:{}}, 
					  bosses: []};
		var buffEventsByFight = buffEventsByFightMap(buffsJSON["events"]);
		for(var fightID in buffEventsByFight){
			var fight = fightsById[fightID];
			var lbThreeTickObj = getLbThreeTickObj(buffEventsByFight[fightID], fight);
			var tickSeconds = msToSeconds(lbThreeTickObj.total);
			var uptimeObjByCharacterID = lbThreeTickObj.characters;
			if(fight.boss != 0){
				result.boss.total += tickSeconds / msToMinutes(times.bossFightTime);
				var name = fight.name + `${!fight.kill ? " (wipe)" : ""}`;
				var fightMs = fight.end_time - fight.start_time;
				var total = tickSeconds / msToMinutes(fightMs);
				var bossCharacters = {};
				for(var id in uptimeObjByCharacterID){
					if(!result.boss.characters[id]){
						result.boss.characters[id] = {uptime: 0, drops: 0};
					}
					var ms = uptimeObjByCharacterID[id].ms;
					var drops = uptimeObjByCharacterID[id].drops;
					result.boss.characters[id].uptime += ms / times.bossFightTime;
					result.boss.characters[id].drops += drops;
					bossCharacters[id] = {uptime: ms / fightMs, drops};
				}
				result.bosses.push({name, total, characters: bossCharacters});
			}
			else{
				result.trash.total += tickSeconds / msToMinutes(times.trashFightTime);
				for(var id in uptimeObjByCharacterID){
					var ms = uptimeObjByCharacterID[id].ms;
					var drops = uptimeObjByCharacterID[id].drops;
					if(!result.trash.characters[id]){
						result.trash.characters[id] = {uptime: 0, drops: 0};
					}
					result.trash.characters[id].uptime += ms / times.trashFightTime;
					result.trash.characters[id].drops += drops;
				}
			}
			result.overall.total += tickSeconds / msToMinutes(times.overallFightTime);
			for(var id in uptimeObjByCharacterID){
				var ms = uptimeObjByCharacterID[id].ms;
				var drops = uptimeObjByCharacterID[id].drops;
				if(!result.overall.characters[id]){
					result.overall.characters[id] = {uptime: 0, drops: 0};
				}
				result.overall.characters[id].uptime += ms / times.overallFightTime;
				result.overall.characters[id].drops += drops;
			}
		}
		return result;
	});
}

function getLbThreeTickObj(events, fight){
	var result = {total: 0, characters: {}};
	var lbEventsMap = lbEventsByTargetIDMap(events);
	var totalMs = 0;
	for(var targetID in lbEventsMap){
		var threeTickObj = getLbThreeTickObjPerTarget(lbEventsMap[targetID], fight);
		result.characters[targetID] = threeTickObj;
		result.total += threeTickObj.ms;
	}
	return result;
}

function getLbThreeTickObjPerTarget(targetEvents, fight){
	var drops = 0;
	var ms = 0;
	var rolling = false;
	var start = fight.start_time;
	targetEvents.forEach((event, idx) => {
		var type = event["type"]
		var timestamp = event["timestamp"];
		var stack = event["stack"] || 0;
		if(type === "refreshbuff" && idx === 0){
			rolling = true;
		}
		else if(type === "applybuffstack" && stack === 3){
			rolling = true;
			start = timestamp;
		}
		else if(type === "removebuff" && rolling){
			drops++;
			rolling = false;
			ms += timestamp - start;
		}
	});
	if(rolling){
		ms += fight.end_time - start;
	}
	return {ms, drops};
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
	//console.log("API Call to " + url);
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
				resolve(body);
			})
		}).on('error', e => {
			reject(e);
		})
	});
}

function filterCharacters(characterList, properties){
	var matches = characterList;
	if(properties["type"]){
		matches = matches.filter(character => character["type"] === properties["type"])
	}
	if(properties["role"]){
		matches = matches.filter(character => character["specs"].filter(spec => spec["role"] === properties["role"]).length > 0);
	}
	return matches;
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

function lbEventsByTargetIDMap(events){
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

function buffEventsByFightMap(buffEvents){
	return buffEvents.reduce((map, event) => {
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

function trimPercent(value){
	return Math.round(value * 10000) / 100;
}

function determineRoles(specs){
	var roles = specs.reduce((roleArr, spec) => {
		var role = spec.role;
		if(!roleArr.includes(role)){
			roleArr.push(role);
		}
		return roleArr;
	}, []);
	roles.sort().reverse();
	return roles.join(",");
}

module.exports = {
    calculate
}