class TapeRec extends AudioWorkletProcessor{
  constructor(){super();this.on=false;this.start=0;this.mask=[true,true,true,true];this.buf=[];for(let c=0;c<4;c++)this.buf.push(new Float32Array(4096));
    this.n=0;this.z=0;this.b=0;this.d=0;this.was=false;
    this.port.onmessage=e=>{const d=e.data;
      if(d.cmd==='start'){this.start=d.frame;this.mask=d.mask;this.n=0;this.z=0;this.b=0;this.d=0;this.was=false;this.on=true;}
      else if(d.cmd==='stop'){this.on=false;this.flush();this.port.postMessage({done:true,z:this.z,b:this.b,d:this.d});}};}
  flush(){if(this.n){this.port.postMessage({chunk:this.buf.map((b,c)=>this.mask[c]?b.slice(0,this.n):null)});this.n=0;}}
  process(inputs){
    if(!this.on)return true;
    const inp=inputs[0]||[];const len=inp[0]?inp[0].length:128;
    if(currentFrame+len<=this.start)return true;
    const off=currentFrame<this.start?this.start-currentFrame:0;
    let nz=false;
    for(let i=off;i<len;i++){
      for(let c=0;c<4;c++){if(!this.mask[c])continue;const ch=inp[c];const v=ch?ch[i]:0;if(v!==0)nz=true;this.buf[c][this.n]=v;}
      if(++this.n===4096)this.flush();}
    this.b++;if(!nz){this.z++;if(this.was)this.d++;}this.was=nz;
    return true;}
}
registerProcessor('tape-rec',TapeRec);
