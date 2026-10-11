param([Parameter(Mandatory=$true)][string]$InputSheet)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=Join-Path $projectRoot 'src\assets\idle'
New-Item -ItemType Directory -Path $output -Force | Out-Null
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.IO;
public static class IdleSheetExtractor {
  public static string Extract(string input, string output) {
    using(var sheet = new Bitmap(input))
    using(var atlas = new Bitmap(1476,1168,PixelFormat.Format32bppArgb))
    using(var ag = Graphics.FromImage(atlas)) {
      int cw=sheet.Width/6, ch=sheet.Height/4;
      if(sheet.Width%6!=0 || sheet.Height%4!=0) throw new Exception("Sheet must be a 6x4 equal grid");
      var boxes=new Rectangle[24];
      var anchors=new double[24];
      int tallest=0;
      for(int i=0;i<24;i++) {
        int ox=(i%6)*cw, oy=(i/6)*ch, l=cw,t=ch,r=-1,b=-1,clear=0;
        for(int y=0;y<ch;y++) for(int x=0;x<cw;x++) {
          int a=sheet.GetPixel(ox+x,oy+y).A;
          if(a<16)clear++;
          if(a<=32)continue;
          l=Math.Min(l,x);r=Math.Max(r,x);t=Math.Min(t,y);b=Math.Max(b,y);
        }
        if(r<l || clear<cw*ch/5) throw new Exception("Missing transparent character cell "+i);
        boxes[i]=new Rectangle(l,t,r-l+1,b-t+1);
        tallest=Math.Max(tallest,b-t+1);
        double sx=0,count=0;
        for(int y=Math.Max(t,b-16);y<=b;y++)for(int x=l;x<=r;x++)
          if(sheet.GetPixel(ox+x,oy+y).A>64){sx+=x;count++;}
        anchors[i]=count>0 ? sx/count : (l+r)/2.0;
      }
      float scale=270f/tallest;
      ag.Clear(Color.Transparent);
      ag.CompositingMode=CompositingMode.SourceOver;
      for(int i=0;i<24;i++) {
        var box=boxes[i];
        using(var frame=new Bitmap(246,292,PixelFormat.Format32bppArgb))
        using(var g=Graphics.FromImage(frame)) {
          g.Clear(Color.Transparent);
          g.CompositingMode=CompositingMode.SourceOver;
          g.InterpolationMode=InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode=PixelOffsetMode.HighQuality;
          float x=123f-(float)(anchors[i]-box.X)*scale;
          float y=284f-box.Height*scale;
          g.DrawImage(sheet,new RectangleF(x,y,box.Width*scale,box.Height*scale),
            new Rectangle((i%6)*cw+box.X,(i/6)*ch+box.Y,box.Width,box.Height),GraphicsUnit.Pixel);
          frame.Save(Path.Combine(output,"idle-"+(i+1).ToString("D2")+".png"),ImageFormat.Png);
          ag.DrawImageUnscaled(frame,(i%6)*246,(i/6)*292);
        }
      }
      atlas.Save(Path.Combine(output,"idle-atlas.png"),ImageFormat.Png);
      return "24 frames + 6x4 atlas; common scale="+scale+"; grounded at y=284; alpha preserved";
    }
  }
}
"@
[IdleSheetExtractor]::Extract((Resolve-Path -LiteralPath $InputSheet).Path,$output)
