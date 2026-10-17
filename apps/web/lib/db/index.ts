import {Pool,type PoolClient} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from './schema';
const globalDb=globalThis as typeof globalThis & {freecodaPool?:Pool};
export function getPool(){if(!process.env.DATABASE_URL)throw new Error('Database is not configured');return globalDb.freecodaPool??=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:10000})}
export function getDb(){return drizzle(getPool(),{schema})}
export async function transaction<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{const client=await getPool().connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
