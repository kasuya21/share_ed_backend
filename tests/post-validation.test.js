import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePostFields} from '../utils/post-validation.js';
test('Returns errors for every missing field',()=>{
 const result=validatePostFields(undefined);
 assert.equal(result.valid,false);
 assert.deepEqual(Object.keys(result.errors),['title','summary','education_level']);
});
test('Rejects whitespace, non-text and unsupported education levels',()=>{
 const result=validatePostFields({title:'  ',summary:{text:'invalid'},education_level:'ADMIN'});
 assert.equal(result.errors.title.code,'REQUIRED');
 assert.equal(result.errors.summary.code,'INVALID_TYPE');
 assert.equal(result.errors.education_level.code,'INVALID_VALUE');
});
test('Accepts supported levels and trims text',()=>{
 for(const level of ['MIDDLE_SCHOOL','HIGH_SCHOOL','UNIVERSITY']){
  const result=validatePostFields({title:' ?????? ',summary:' ???? ',education_level:level});
  assert.equal(result.valid,true);assert.deepEqual(result.values,{title:'??????',summary:'????',education_level:level});
 }
});
test('Partial updates allow omitted fields but reject explicit empty values',()=>{
 assert.equal(validatePostFields({},{partial:true}).valid,true);
 for(const value of [null,'',[],0,false])assert.equal(validatePostFields({summary:value},{partial:true}).valid,false);
 assert.deepEqual(validatePostFields({title:' ???? '},{partial:true}).values,{title:'????'});
});


test('New posts require all fields, a separate cover and at least one attachment',async()=>{
 const {validateNewPost}=await import('../utils/post-validation.js');
 const empty=validateNewPost({},{});
 assert.deepEqual(Object.keys(empty.errors).sort(),['title','summary','education_level','category_id','cover_image','media_files'].sort());
 const body={title:'Title',summary:'Abstract',education_level:'UNIVERSITY',category_id:'subject'};
 const image={mimetype:'image/png'};
 assert.equal(validateNewPost(body,{cover_image:[image]}).errors.media_files.code,'REQUIRED');
 assert.equal(validateNewPost(body,{media_files:[image]}).errors.cover_image.code,'REQUIRED');
 for(const mimetype of ['application/pdf','image/jpeg','image/png','image/webp']) assert.equal(validateNewPost(body,{cover_image:[image],media_files:[{mimetype}]}).valid,true);
 assert.equal(validateNewPost(body,{cover_image:[{mimetype:'application/pdf'}],media_files:[image]}).valid,false);
 assert.equal(validateNewPost(body,{cover_image:[image],media_files:[{mimetype:'video/mp4'}]}).valid,false);
});

test('Draft posts may be saved before category and files are complete',async()=>{
 const {validateNewPost}=await import('../utils/post-validation.js');
 const result=validateNewPost({post_status:'DRAFT',title:'',summary:'',education_level:''},{});
 assert.equal(result.valid,true);
 assert.deepEqual(result.values,{title:'Untitled draft',summary:'',education_level:'UNIVERSITY'});
});
