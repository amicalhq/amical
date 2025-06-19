import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function VocabularyView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Vocabulary</h2>
          <p className="text-muted-foreground">Manage custom vocabulary to boost speech recognition for company-specific terms.</p>
        </div>
        <Button>Import</Button>
      </div>
      
      <Tabs defaultValue="list" className="w-full">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>
        
        <TabsContent value="list" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <p className="text-muted-foreground">No custom words yet – add some!</p>
                <Button className="mt-4" variant="outline">Add Word</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import Vocabulary</CardTitle>
              <CardDescription>Paste comma-separated words...</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea 
                className="w-full h-32 border rounded px-3 py-2" 
                placeholder="Enter words separated by commas..."
              />
              <Button>Import</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 