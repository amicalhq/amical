import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function ModelsView() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Models</h2>
      
      <Tabs defaultValue="speech" className="w-full">
        <TabsList>
          <TabsTrigger value="speech">Speech Recognition</TabsTrigger>
          <TabsTrigger value="formatting">Formatting LLM</TabsTrigger>
        </TabsList>
        
        <TabsContent value="speech" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Whisper Speech Models</CardTitle>
              <CardDescription>Choose your preferred speech recognition model</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center space-x-3">
                    <input type="radio" name="model" id="tiny" />
                    <div>
                      <Label htmlFor="tiny" className="font-medium">Tiny</Label>
                      <div className="text-sm text-muted-foreground">75 MB - RAM ~390 MB</div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 border rounded bg-muted">
                  <div className="flex items-center space-x-3">
                    <input type="radio" name="model" id="base" defaultChecked />
                    <div>
                      <Label htmlFor="base" className="font-medium">Base</Label>
                      <div className="text-sm text-muted-foreground">142 MB - RAM ~520 MB</div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center space-x-3">
                    <input type="radio" name="model" id="small" />
                    <div>
                      <Label htmlFor="small" className="font-medium">Small</Label>
                      <div className="text-sm text-muted-foreground">466 MB - RAM ~1.3 GB</div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">Download</Button>
                </div>
                
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center space-x-3">
                    <input type="radio" name="model" id="medium" />
                    <div>
                      <Label htmlFor="medium" className="font-medium">Medium</Label>
                      <div className="text-sm text-muted-foreground">1.5 GB - RAM ~3.0 GB</div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">Download</Button>
                </div>
                
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center space-x-3">
                    <input type="radio" name="model" id="large" />
                    <div>
                      <Label htmlFor="large" className="font-medium">Large</Label>
                      <div className="text-sm text-muted-foreground">2.9 GB - RAM ~4.8 GB</div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">Download</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="formatting" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Formatting Model</CardTitle>
              <CardDescription>Configure your text formatting preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="formatting-model">Formatting Model</Label>
                <select id="formatting-model" className="w-full border rounded px-3 py-2">
                  <option>OpenAI</option>
                  <option>Local Model</option>
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key or local model name</Label>
                <input 
                  type="password" 
                  id="api-key" 
                  className="w-full border rounded px-3 py-2"
                  placeholder="Enter API key or model name"
                />
              </div>
              
              <Button>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 