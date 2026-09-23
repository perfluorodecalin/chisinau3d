import assert from 'node:assert/strict';
import {buildingCsv} from '../dist/csv-export.js';

const data = buildingCsv([
  {type:'way', id:123, tags:{name:'=HYPERLINK("https://bad")',building:'house'}, height:6.5, source:'height', floors:2, area:41.7, reason:'-cmd| /C calc'},
  {type:'way', id:123, tags:{name:'duplicate',building:'yes'}, height:1, source:'estimate', floors:null, area:2, reason:'duplicate'},
  {type:'relation', id:456, tags:{name:'  +SUM(1,1)',building:'@SUM(1,1)'}, height:8, source:'estimate', floors:3, area:50, reason:'\t=1+1'},
  {type:'way', id:789, tags:{name:'＝SUM(1,1)',building:'yes'}, height:4, source:'estimate', floors:null, area:20, reason:'Mapped building'},
]);
const lines = data.replace(/^\uFEFF/, '').split('\r\n');
assert.equal(lines.length, 4, 'duplicate OSM features are omitted');
assert.match(lines[1], /,"'=HYPERLINK\(""https:\/\/bad""\)","house",6\.5,"height",2,42,"'-cmd\| \/C calc"$/);
assert.match(lines[2], /,"'  \+SUM\(1,1\)","'@SUM\(1,1\)",8,"estimate",3,50,"'\t=1\+1"$/);
assert.match(lines[3], /,"'＝SUM\(1,1\)","yes",4,"estimate",,20,"Mapped building"$/);
assert.match(lines[1], /^"way",123,/);
assert.ok(!lines[1].includes('"123"'), 'OSM IDs remain numeric CSV cells');
assert.ok(!lines[1].includes('"6.5"'), 'height remains a numeric CSV cell');
assert.ok(!lines[1].includes('"42"'), 'rounded footprint remains a numeric CSV cell');
console.log('CSV export formula safety and numeric cells passed');
