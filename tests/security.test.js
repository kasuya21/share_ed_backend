import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { bearerToken, rateLimit, securityHeaders, errorHandler } from '../utils/security.js';
import { socketAuth, joinOwnRoom } from '../middlewares/socket.middleware.js';
import { isSupportedFile } from '../utils/upload-validation.js';

test('Upload signature rejects SVG and HTML disguised as an image', () => {
  assert.equal(isSupportedFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), false);
  assert.equal(isSupportedFile(Buffer.from('<html><script>alert(1)</script></html>')), false);
  assert.equal(isSupportedFile(Buffer.from('%PDF-1.7\nexample')), true);
  assert.equal(isSupportedFile(Buffer.alloc(0)), false);
});

test('Bearer parsing rejects malformed credentials', () => {
  for (const value of [undefined, {}, 'token', 'Basic abc', 'Bearer a b', 'Bearer ']) assert.equal(bearerToken(value), null);
  assert.equal(bearerToken('bearer abc'), 'abc');
});

test('Socket authentication rejects invalid and suspended users', async () => {
  for (const status of [null, 'SUSPENDED', 'BANNED', 'ACTIVE']) {
    const socket = { handshake: { auth: {token:'valid'}, headers:{} }, data:{} };
    const auth = socketAuth({auth:{getUser:async () => ({data:{user:{id:'owner'}}})}}, {user:{findUnique:async () => status ? {status} : null}});
    let result;
    await auth(socket, error => { result = error; });
    assert.equal(Boolean(result), status !== 'ACTIVE');
    if (status === 'ACTIVE') assert.equal(socket.data.userId, 'owner');
  }
  const socket = {handshake:{auth:{},headers:{}},data:{}};
  await socketAuth({}, {})(socket, error => assert.equal(error.message, 'Unauthorized'));
  socket.handshake.auth.token = 'forged';
  await socketAuth({auth:{getUser:async () => ({error: new Error()})}}, {})(socket, error => assert.equal(error.message, 'Unauthorized'));
});

test('Socket join cannot subscribe to another user', () => {
  const rooms = []; let join;
  joinOwnRoom({data:{userId:'owner'},join:room=>rooms.push(room),on:(event,handler)=>{join=handler;}});
  join('victim');
  assert.deepEqual(rooms, ['user:owner','user:owner']);
});

test('HTTP limits, security headers and safe errors', async t => {
  let time = 0;
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use('/limited', rateLimit({limit:2,windowMs:1000,now:()=>time}));
  app.get('/limited', (req,res)=>res.send('ok'));
  app.use(express.json({limit:'100b'}));
  app.post('/body', (req,res)=>res.json(req.body));
  app.get('/error', ()=>{throw new Error('secret database details');});
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  for (let i=0;i<2;i++) assert.equal((await fetch(url+'/limited')).status,200);
  const blocked = await fetch(url+'/limited');
  assert.equal(blocked.status,429);
  assert.equal(blocked.headers.get('retry-after'),'1');
  time = 1000;
  assert.equal((await fetch(url+'/limited')).status,200);
  const error = await fetch(url+'/error',{headers:{authorization:'Bearer token'}});
  assert.equal(error.status,500);
  assert.equal(error.headers.get('x-powered-by'),null);
  assert.equal(error.headers.get('cache-control'),'no-store');
  assert.equal(error.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(await error.json(),{message:'Internal server error'});
  for (const [body,status] of [['{',400],[JSON.stringify({value:'x'.repeat(101)}),413]]) {
    assert.equal((await fetch(url+'/body',{method:'POST',headers:{'content-type':'application/json'},body})).status,status);
  }
});


test('Multipart rejects forged content before controllers run', async t => {
  const { upload } = await import('../middlewares/upload.middleware.js');
  const app = express();
  app.post('/', upload.single('image'), (req,res)=>res.sendStatus(204));
  app.use(errorHandler);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  for (const [body,type,status] of [['<svg>malicious content</svg>','image/png',400],['<svg>malicious content</svg>','image/svg+xml',400],['%PDF-1.7 example','application/pdf',204]]) {
    const form = new FormData();
    form.append('image',new Blob([body],{type}),'test');
    assert.equal((await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',body:form})).status,status);
  }
});
