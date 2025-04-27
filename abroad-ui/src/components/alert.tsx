import React from "react";
import { Card, CardContent } from "./card";
import { Button } from "./button";
import { AlertTriangle } from "lucide-react";

interface AlertProps {
  title: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
}

export function Alert({ title, description, isOpen, onClose }: AlertProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center backdrop-blur-sm z-50"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.60)' }}
      onClick={onClose}
    >
      <Card
        className="w-11/12 max-w-md bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="flex flex-col items-center text-center p-6">
          <div className="bg-gradient-to-r from-[#48b395] to-[#247469] rounded-full p-3 mb-4">
            <AlertTriangle className="w-8 h-8 text-white" />
          </div>
          
          <h2 className="text-xl font-semibold mb-2">{title}</h2>
          <p className="text-gray-600 mb-6">{description}</p>

          <Button
            onClick={onClose}
            className="min-w-[100px] rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
          >
            OK
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}