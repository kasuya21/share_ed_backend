import test from 'node:test';
import assert from 'node:assert/strict';
// Isolated mocks: no production credentials or external calls are needed.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-key';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { supabase } = await import('../configs/supabase.config.js');
const { prisma } = await import('../configs/prisma.js');
const { authMiddleware, provisioningAuthMiddleware } = await import('../middlewares/auth.middleware.js');
const { verifyUser, registerUser } = await import('../controllers/auth.controller.js');
const { updatePost } = await import('../controllers/post.controller.js');
function mockPrisma(t, target, method, implementation) {
  const original = target[method];
  const mocked = t.mock.fn(implementation);
  target[method] = mocked;
  t.after(() => { target[method] = original; });
  return mocked;
}
function response() { return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}; }

test('Unprovisioned accounts only access the provisioning route', async t => {
  t.mock.method(supabase.auth,'getUser',async()=>({data:{user:{id:'new-user'}}}));
  mockPrisma(t,prisma.user,'findUnique',async()=>null);
  const req={headers:{authorization:'Bearer valid'}};
  let next=0; const res=response();
  await authMiddleware(req,res,()=>next++);
  assert.equal(res.statusCode,403); assert.equal(next,0);
  await provisioningAuthMiddleware(req,response(),()=>next++);
  assert.equal(next,1);
});

test('Inactive accounts are rejected even on provisioning', async t => {
  t.mock.method(supabase.auth,'getUser',async()=>({data:{user:{id:'user'}}}));
  mockPrisma(t,prisma.user,'findUnique',async()=>({status:'SUSPENDED'}));
  const res=response();
  await provisioningAuthMiddleware({headers:{authorization:'Bearer valid'}},res,()=>assert.fail('must reject'));
  assert.equal(res.statusCode,403);
});

test('Matching email cannot transfer an existing account to another identity', async t => {
  t.mock.method(supabase.auth,'getUser',async()=>({data:{user:{id:'new-id',email:'same@example.com'}}}));
  mockPrisma(t,prisma.user,'findUnique',async({where})=>where.email ? {id:'original-id'} : null);
  const update=mockPrisma(t,prisma.user,'update',async()=>assert.fail('must not transfer account'));
  const raw=mockPrisma(t,prisma,'$executeRawUnsafe',async()=>assert.fail('must not rewrite identity'));
  const res=response(); await verifyUser({headers:{authorization:'Bearer valid'}},res);
  assert.equal(res.statusCode,409);
  assert.equal(update.mock.callCount(),0); assert.equal(raw.mock.callCount(),0);
});

test('Invalid registration input is rejected before database access', async t => {
  mockPrisma(t,prisma.user,'findUnique',async()=>assert.fail('must validate first'));
  const res=response(); await registerUser({body:{email:{},password:'password',username:[]}},res);
  assert.equal(res.statusCode,400);
});

test('Post owners cannot bypass moderation or set reserved statuses', async t => {
  let status='UNACTIVED';
  mockPrisma(t,prisma.post,'findUnique',async()=>({id:'post',author_id:'owner',post_status:status}));
  mockPrisma(t,prisma.post,'update',async()=>assert.fail('must reject before update'));
  for (const [stored,requested,expected] of [['UNACTIVED','ACTIVE',403],['DELETED','ACTIVE',403],['ACTIVE','UNACTIVED',400]]) {
    status=stored; const res=response();
    await updatePost({params:{id:'post'},user:{id:'owner'},body:{post_status:requested}},res);
    assert.equal(res.statusCode,expected);
  }
});
