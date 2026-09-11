import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
test('local check payee setting saves/reloads, clears, validates and preserves payment settings',async()=>{
 const child=spawn('docker',['exec','-i','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
 const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 child.stdin.end(await readFile(new URL('./checks_payable_to.sql',import.meta.url),'utf8'));
 assert.equal(await finished,0,output);
});
