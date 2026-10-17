import { z } from 'zod';
export const DAILY_FREE_MICROS=100_000;
export const MONTHLY_FREE_MICROS=62_000_000;
export const CREDIT_PACK_MICROS=5_000_000;
export const MAX_REQUEST_BYTES=100_000;
export const deviceStartSchema=z.object({name:z.string().trim().min(1).max(80)}).strict();
export const devicePollSchema=z.object({deviceCode:z.string().min(32).max(100)}).strict();
export const deviceApproveSchema=z.object({code:z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)}).strict();
export const inferenceSchema=z.object({model:z.string().min(1).max(150),messages:z.array(z.record(z.string(),z.unknown())).min(1).max(100),tools:z.array(z.record(z.string(),z.unknown())).max(10).optional(),tool_choice:z.unknown().optional(),stream:z.boolean().default(true),stream_options:z.object({include_usage:z.boolean().optional()}).optional(),max_tokens:z.number().int().min(1).max(4096).optional(),max_completion_tokens:z.number().int().min(1).max(4096).optional(),temperature:z.number().min(0).max(2).optional()}).strict();
export type ModelConfig={id:string;provider:string;inputMicrosPerToken:number;outputMicrosPerToken:number;maxContextTokens:number;approved:boolean;};
export type UsageSnapshot={freeRemainingMicros:number;walletMicros:number;paidEnabled:boolean;resetAt:string;};
export function paidCharge(costMicros:number){if(!Number.isSafeInteger(costMicros)||costMicros<0)throw new Error('Invalid cost');return Math.ceil(costMicros*1.5)}
export function utcDay(date=new Date()){return date.toISOString().slice(0,10)}
export function utcMonth(date=new Date()){return date.toISOString().slice(0,7)}
export function nextReset(date=new Date()){return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString()}
