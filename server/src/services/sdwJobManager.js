/**
 * SDW Job Manager
 * Tracks SDW processing jobs and their progress
 */

const jobs = new Map();

class SDWJob {
  constructor(jobId, orderNumber) {
    this.jobId = jobId;
    this.orderNumber = orderNumber;
    this.status = 'pending'; // pending, processing, awaiting_confirmation, completing, completed, failed
    this.phase = null; // calculate, purchase
    this.progress = [];
    this.currentStep = null;
    this.totalPrice = null;
    this.shippingCost = null;
    this.error = null;
    this.result = null;
    this.orderItems = null; // Items being processed
    this.orderSummary = null; // Order summary (subtotal, shipping, tax, etc.)
    this.completionData = null; // Success data (invoice number, etc.)
    this.failureData = null; // Failure data (error details)
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  addProgress(message, step = null) {
    this.progress.push({
      message,
      timestamp: new Date()
    });
    if (step) {
      this.currentStep = step;
    }
    this.updatedAt = new Date();
  }

  setCalculateComplete(totalPrice, shippingCost) {
    this.status = 'awaiting_confirmation';
    this.phase = 'calculate';
    this.totalPrice = totalPrice;
    this.shippingCost = shippingCost;
    this.addProgress(`Shipping calculated: $${shippingCost}. Total: $${totalPrice}`, 'awaiting_confirmation');
  }

  setProcessing(phase = 'calculate') {
    this.status = 'processing';
    this.phase = phase;
    this.updatedAt = new Date();
  }

  setCompleted(result) {
    this.status = 'completed';
    this.result = result;
    this.addProgress('Order processing completed successfully', 'completed');
  }

  setFailed(error) {
    this.status = 'failed';
    this.error = error;
    this.addProgress(`Error: ${error}`, 'failed');
  }

  getStatus() {
    return {
      jobId: this.jobId,
      orderNumber: this.orderNumber,
      status: this.status,
      phase: this.phase,
      currentStep: this.currentStep,
      progress: this.progress,
      totalPrice: this.totalPrice,
      shippingCost: this.shippingCost,
      error: this.error,
      result: this.result,
      orderItems: this.orderItems,
      orderSummary: this.orderSummary,
      completionData: this.completionData,
      failureData: this.failureData,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

function createJob(orderNumber) {
  const jobId = `sdw_${orderNumber}_${Date.now()}`;
  const job = new SDWJob(jobId, orderNumber);
  jobs.set(jobId, job);

  // Clean up old jobs after 1 hour
  setTimeout(() => {
    jobs.delete(jobId);
  }, 60 * 60 * 1000);

  return job;
}

function getJob(jobId) {
  return jobs.get(jobId);
}

function updateJobProgress(jobId, message, step = null) {
  const job = jobs.get(jobId);
  if (job) {
    job.addProgress(message, step);
  }
}

export {
  createJob,
  getJob,
  updateJobProgress,
  SDWJob
};
