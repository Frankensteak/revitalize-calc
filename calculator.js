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
			return getRevitProcs(apiKey, logId, times).then(revitProcResults => {
				var result = process(revitProcResults, restos, charactersById, fightsById)
				CACHE[logId] = result;
				return result;
			})
		});
	});
}
/*
revitProcResults{
	energy: {events: array[Event]},
	mana: {events: array[Event]},
	rage: {events: array[Event]},
	runic: {events: array[Event]}
}

48540(energy) = resourceChangeType 3
48541(rage) = resourceChangeType 1
48542(mana) = resourceChangeType 2
48543(runic) = resourceChangeType 6

Event: {
  timestamp: 1610033,
  type: 'resourcechange',
  sourceID: 4,
  sourceIsFriendly: true,
  targetID: 4,
  targetIsFriendly: true,
  ability: {
    name: 'Revitalize',
    guid: 48540,
    type: 8,
    abilityIcon: 'ability_druid_replenish.jpg'
  },
  fight: 19,
  pin: '0',
  resourceChange: 8,
  resourceChangeType: 3,
  otherResourceChange: 0,
  maxResourceAmount: 100,
  waste: 0,
  resourceActor: 1,
  classResources: [ { amount: 78, max: 100, type: 3 } ],
  hitPoints: 100,
  maxHitPoints: 100,
  attackPower: 6106,
  spellPower: 367,
  armor: 8680,
  x: 305467,
  y: 337794,
  facing: -276,
  mapID: 162,
  itemLevel: 203
}
*/

//Per character, build overall, boss, trash, bosses maps, then structure into expected format
function process(revitProcResults){
	var result = {}
	for(var character of restos){
		result[character.name] = {}

	}
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
	
function getRevitProcs(apiKey, logId, times){
	var promises = []
	var energyPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 103, filter: "ability.id%3D48540"}).then(response => {
		var result = {}
		result.type = "energy";
		result.data = response;
		return result;
	});
	promises.push(energyPromise);
	var ragePromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 101, filter: "ability.id%3D48541"}).then(response => {
		var result = {}
		result.type = "rage";
		result.data = response;
		return result;
	});
	promises.push(ragePromise);
	var manaPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 100, filter: "ability.id%3D48542"}).then(response => {
		var result = {}
		result.type = "mana";
		result.data = response;
		return result;
	});
	promises.push(manaPromise);
	var runicPromise = get(apiKey, logId, "events", "resources", {end: times.endTime, abilityid: 106, filter: "ability.id%3D48543"}).then(response => {
		var result = {}
		result.type = "runic";
		result.data = response;
		return result;
	});
	promises.push(runicPromise);
	return Promise.all(promises).then(responses => {
		var result = {};
		for(var response of responses){
			result[response.type] = response.data
		}
		return result;
	})
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