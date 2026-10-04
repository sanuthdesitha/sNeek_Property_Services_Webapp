import {Role} from "@prisma/client";
import {requireRole} from "@/lib/auth/session";
import {TurnoverProfit} from "@/components/operations/turnover-profit";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams?:{jobId?:string}}){await requireRole([Role.ADMIN]);return <TurnoverProfit initialJobId={searchParams?.jobId}/>;}
