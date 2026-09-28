import React from "react";
import { createRoot } from "react-dom/client";
import { StageClean } from "@/components/v2/cleaner/job-stages/stage-clean";
const schema = { sections: [{id:"kitchen", title:"Kitchen", fields:[{id:"kitchen_note",type:"text",label:"Kitchen note",required:true}]},{id:"bedroom",title:"Bedroom",fields:[{id:"bedroom_note",type:"text",label:"Bedroom note",required:true}]}] };
function Fixture() {
 const [answers, setAnswers] = React.useState({});
 const api: any = {schema,answers,uploads:{},jobTasks:[],taskDrafts:{},locked:false,property:{name:"Harbour apartment"},jobId:"job",template:{name:"Cleaning checklist"},bulkPool:[],bulkAssignOpen:false,onAnswer:(id:string,value:unknown)=>setAnswers(prev=>({...prev,[id]:value})),onUpload:()=>{},setBulkPool:()=>{},setUploads:()=>{},closeBulkAssign:()=>{},requiredChecklistTicksBlockSubmit:true};
 return <div data-skin="estate" style={{ fontFamily: "Arial, sans-serif" }} className="estate-root min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))] p-3 sm:p-6" data-portal-accent="cleaner"><div className="mx-auto max-w-4xl"><StageClean api={api}/></div></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
