import {publicConfig} from './config';
import {json,handle,ApiError} from './http';
export async function route(req:Request){return handle(async()=>{const path=new URL(req.url).pathname.replace('/api/v1/','');if(path==='health')return json({status:'ok',...publicConfig()});if(path==='workspace'){const c=publicConfig();return json({configured:c.auth,services:[{label:'Account sign-in',ready:c.auth},{label:'Usage database',ready:c.database},{label:'Hosted AI',ready:c.gateway&&c.hostedEnabled},{label:'Credit purchases',ready:c.payments}]})}throw new ApiError(404,'Endpoint not found.')})}
