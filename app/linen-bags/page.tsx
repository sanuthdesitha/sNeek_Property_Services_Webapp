import { getAppSettings } from "@/lib/settings";
import {Role} from "@prisma/client";
import {requireSession} from "@/lib/auth/session";
import {LinenBags} from "@/components/operations/linen-bags";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams?:{taskId?:string}}){const session=await requireSession();if(![Role.ADMIN,Role.CLEANER,Role.LAUNDRY].includes(session.user.role as any))return <p>Bag custody is restricted to the assigned operations team.</p>;return <LinenBags timeZone={(await getAppSettings()).timezone} role={session.user.role} initialTaskId={searchParams?.taskId}/>;}
