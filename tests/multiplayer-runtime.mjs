import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
const mf = new Miniflare({ modules:true, modulesRules:[{type:'ESModule',include:['**/*.js']}], scriptPath:new URL('../relay/worker.js', import.meta.url).pathname, modulesRoot:new URL('..', import.meta.url).pathname, durableObjects:{ROOMS:{className:'Room',useSQLite:true}}, ratelimits:{UPGRADE_LIMIT:{simple:{limit:60,period:60}}}, bindings:{PAGES_ORIGIN:'http://localhost:5173'} });
const room = crypto.randomUUID(), world='a'.repeat(64);
async function join(worldId=world, id=room) {
 const response=await mf.dispatchFetch(`http://localhost/rooms/${id}?world=${worldId}`,{headers:{Origin:'http://localhost:5173',Upgrade:'websocket'}});
 assert.equal(response.status,101); const socket=response.webSocket; socket.accept();
 const messages=[]; socket.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
 await new Promise(r=>setTimeout(r,30)); return {socket,messages};
}
try {
 const a=await join(), b=await join();
 assert.equal(a.messages[0].t,'welcome'); assert.equal(b.messages[0].t,'welcome');
 const pose={active:true,x:1,y:2,z:3,heading:4,speed:5};
 a.socket.send(JSON.stringify({t:'tick',v:2,n:0,p:pose}));
 await new Promise(r=>setTimeout(r,30)); assert.equal(a.messages.at(-1).peers.length,1);
 b.socket.send(JSON.stringify({t:'tick',v:2,n:0,p:{...pose,x:42}}));
 await new Promise(r=>setTimeout(r,30)); assert.equal(b.messages.at(-1).peers[0].x,1);
 const c=await join(); c.socket.send(JSON.stringify({t:'tick',v:2,n:0,p:pose}));
 await new Promise(r=>setTimeout(r,30)); assert.equal(c.messages.at(-1).peers.length,2);
 const mismatch=await join('b'.repeat(64)); assert.equal(mismatch.messages[0].reason,'world');
 for(let i=3;i<8;i++) await join();
 const full=await join(); assert.equal(full.messages[0].reason,'full');
 console.log('Actual workerd WebSocket and DO roundtrip, late join, isolation and capacity passed.');
} finally { await mf.dispose(); }
