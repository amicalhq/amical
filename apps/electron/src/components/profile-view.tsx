import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function ProfileView() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Profile</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
          <CardDescription>Manage your profile information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold">U</span>
            </div>
            <div>
              <h3 className="font-medium">User</h3>
              <p className="text-sm text-muted-foreground">Local Account</p>
            </div>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <input 
                type="text" 
                id="display-name" 
                className="w-full border rounded px-3 py-2"
                placeholder="Enter your name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <input 
                type="email" 
                id="email" 
                className="w-full border rounded px-3 py-2"
                placeholder="Enter your email"
              />
            </div>
          </div>
          
          <Button>Save Changes</Button>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Usage Statistics</CardTitle>
          <CardDescription>Your transcription activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center">
              <div className="text-2xl font-bold">42,690</div>
              <div className="text-sm text-muted-foreground">Total Words</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">128</div>
              <div className="text-sm text-muted-foreground">Sessions</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">24h 12m</div>
              <div className="text-sm text-muted-foreground">Total Time</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 