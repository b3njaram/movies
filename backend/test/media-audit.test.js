import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditMediaFolder} from '../media-audit.js';

test('read-only media audit detects missing paths and sampled duplicate candidates',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sh-audit-'));
  try{
    await fs.writeFile(path.join(root,'movie1.mp4'),Buffer.alloc(4096,7));
    await fs.writeFile(path.join(root,'movie2.mp4'),Buffer.alloc(4096,7));
    await fs.writeFile(path.join(root,'different.mp4'),Buffer.alloc(4096,8));
    await fs.writeFile(path.join(root,'small.mp4'),Buffer.alloc(50,7));
    await fs.symlink(path.join(root,'movie1.mp4'),path.join(root,'video-link.mp4'));
    const result=await auditMediaFolder(root,[{rel_path:'movie1.mp4'},{rel_path:'missing.mp4'}]);
    assert.equal(result.scanned,3);
    assert.deepEqual(result.missing,['missing.mp4']);
    assert.equal(result.possibleDuplicates.length,1);
    assert.deepEqual(result.possibleDuplicates[0].files.sort(),['movie1.mp4','movie2.mp4']);
    assert.equal((await fs.readFile(path.join(root,'movie1.mp4'))).length,4096);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a symbolic-link media root is rejected',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sh-audit-'));
  const link=root+'-link';
  try{await fs.symlink(root,link);await assert.rejects(auditMediaFolder(link,[]),/symlink/);}
  finally{await fs.rm(link,{force:true});await fs.rm(root,{recursive:true,force:true});}
});
