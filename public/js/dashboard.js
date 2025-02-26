document.addEventListener('DOMContentLoaded', function() {
    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl)
    });
    
    // Add active class to current navigation item
    const currentLocation = location.pathname;
    const navItems = document.querySelectorAll('.nav-link');
    navItems.forEach(item => {
      if(item.getAttribute('href') === currentLocation) {
        item.classList.add('active');
      }
    });
    
    // Request filtering functionality
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(button => {
      button.addEventListener('click', function() {
        // Remove active class from all buttons
        filterButtons.forEach(btn => btn.classList.remove('active'));
        
        // Add active class to the clicked button
        this.classList.add('active');
        
        // Get the filter type from the data attribute
        const filterType = this.getAttribute('data-filter');
        
        // Get all request cards
        const requestCards = document.querySelectorAll('.request-card');
        
        // Show/hide request cards based on the filter
        requestCards.forEach(card => {
          if (filterType === 'all') {
            card.style.display = 'block';
          } else if (filterType === 'pending') {
            if (card.classList.contains('request-pending')) {
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          } else if (filterType === 'approved') {
            if (card.classList.contains('request-supervisor') || card.classList.contains('request-admin')) {
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          } else if (filterType === 'signed-off') {
            if (card.classList.contains('request-ceo')) {
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          }
        });
      });
    });
    
    // Month switcher functionality
    const monthDropdownItems = document.querySelectorAll('.dropdown-menu .dropdown-item');
    const monthDropdownButton = document.getElementById('monthDropdown');
    
    if (monthDropdownItems.length > 0 && monthDropdownButton) {
      monthDropdownItems.forEach(item => {
        item.addEventListener('click', function(e) {
          e.preventDefault();
          
          // Update the dropdown button text
          monthDropdownButton.innerText = this.innerText;
          
          // Extract month and year from text (format: "Month YYYY")
          const parts = this.innerText.trim().split(' ');
          const month = getMonthNumber(parts[0]);
          const year = parseInt(parts[1]);
          
          // Navigate to dashboard with query params
          window.location.href = `/dashboard?month=${month}&year=${year}`;
        });
      });
    }
    
    // Helper function to convert month name to number
    function getMonthNumber(monthName) {
      const months = {
        'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
        'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
      };
      return months[monthName] || 0;
    }
    
    // Handle AJAX for approval buttons
    const approvalButtons = document.querySelectorAll('.approval-btn');
    approvalButtons.forEach(button => {
      button.addEventListener('click', async function(e) {
        e.preventDefault();
        
        const requestId = this.getAttribute('data-request-id');
        const action = this.getAttribute('data-action');
        const url = `/requests/${requestId}/${action}`;
        
        try {
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (response.ok) {
            // Update UI to reflect approval without page refresh
            const requestCard = button.closest('.request-card');
            const statusBadge = requestCard.querySelector('.status-badge');
            
            // Remove old status classes
            requestCard.classList.remove('request-pending', 'request-supervisor', 'request-admin', 'request-ceo');
            statusBadge.classList.remove('badge-pending', 'badge-supervisor', 'badge-admin', 'badge-ceo');
            
            // Update status text and class
            if (action === 'supervisor-approve') {
              statusBadge.textContent = 'Supervisor Approved';
              statusBadge.classList.add('badge-supervisor');
              requestCard.classList.add('request-supervisor');
            } else if (action === 'admin-approve') {
              statusBadge.textContent = 'Admin Approved';
              statusBadge.classList.add('badge-admin');
              requestCard.classList.add('request-admin');
            } else if (action === 'ceo-signoff') {
              statusBadge.textContent = 'CEO Signed Off';
              statusBadge.classList.add('badge-ceo');
              requestCard.classList.add('request-ceo');
            }
            
            // Hide the button
            button.style.display = 'none';
            
            // Update counts and badges
            updateRequestCounts();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            button.disabled = false;
            button.innerHTML = button.getAttribute('data-original-text') || 'Approve';
          }
        } catch (error) {
          console.error('Error during approval:', error);
          alert('An error occurred during approval. Please try again.');
          button.disabled = false;
          button.innerHTML = button.getAttribute('data-original-text') || 'Approve';
        }
      });
    });
    
    // Handle AJAX for batch approval buttons
    const batchApproveButtons = document.querySelectorAll('.batch-approve-btn');
    batchApproveButtons.forEach(button => {
      button.addEventListener('click', async function(e) {
        e.preventDefault();
        
        // Show confirmation dialog
        if (!confirm('Are you sure you want to approve all eligible requests for this user?')) {
          return;
        }
        
        const userId = this.getAttribute('data-user-id');
        const action = this.getAttribute('data-action');
        
        try {
          // Show loading state
          const originalText = button.innerHTML;
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          // Send AJAX request to approve all requests
          const response = await fetch(`/users/${userId}/batch-approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ action: action })
          });
          
          if (response.ok) {
            const result = await response.json();
            
            // Update UI for each affected request
            const userAccordion = button.closest('.accordion-item');
            const requestCards = userAccordion.querySelectorAll('.request-card');
            
            requestCards.forEach(card => {
              const statusBadge = card.querySelector('.status-badge');
              const approvalBtn = card.querySelector('.approval-btn');
              
              if (action === 'supervisor-approve' && card.classList.contains('request-pending')) {
                // Update for supervisor approval
                card.classList.remove('request-pending');
                card.classList.add('request-supervisor');
                statusBadge.classList.remove('badge-pending');
                statusBadge.classList.add('badge-supervisor');
                statusBadge.textContent = 'Supervisor Approved';
                if (approvalBtn) approvalBtn.style.display = 'none';
              } else if (action === 'admin-approve' && card.classList.contains('request-supervisor')) {
                // Update for admin approval
                card.classList.remove('request-supervisor');
                card.classList.add('request-admin');
                statusBadge.classList.remove('badge-supervisor');
                statusBadge.classList.add('badge-admin');
                statusBadge.textContent = 'Admin Approved';
                if (approvalBtn) approvalBtn.style.display = 'none';
              } else if (action === 'ceo-signoff' && card.classList.contains('request-admin')) {
                // Update for CEO sign-off
                card.classList.remove('request-admin');
                card.classList.add('request-ceo');
                statusBadge.classList.remove('badge-admin');
                statusBadge.classList.add('badge-ceo');
                statusBadge.textContent = 'CEO Signed Off';
                if (approvalBtn) approvalBtn.style.display = 'none';
              }
            });
            
            // Hide the batch approve button
            button.style.display = 'none';
            
            // Update the counts
            updateRequestCounts();
            
            // Show success message
            alert(`Success! ${result.message}`);
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            button.disabled = false;
            button.innerHTML = originalText;
          }
        } catch (error) {
          console.error('Error during batch approval:', error);
          alert('An error occurred during batch approval. Please try again.');
          button.disabled = false;
          button.innerHTML = originalText;
        }
      });
    });
    
    // Handle tech delete requests via AJAX
    const deleteTechButtons = document.querySelectorAll('.delete-tech-btn');
    deleteTechButtons.forEach(button => {
      button.addEventListener('click', async function(e) {
        e.preventDefault();
        
        if (!confirm('Are you sure you want to delete this request? This action cannot be undone.')) {
          return;
        }
        
        const requestId = this.getAttribute('data-request-id');
        
        try {
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
          
          const response = await fetch(`/requests/${requestId}/delete`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (response.ok) {
            // Remove the request card from the UI
            const requestCard = button.closest('.request-card');
            requestCard.remove();
            
            // Update counts
            updateRequestCounts();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-trash me-1"></i> Delete';
          }
        } catch (error) {
          console.error('Error deleting request:', error);
          alert('An error occurred while deleting the request. Please try again.');
          button.disabled = false;
          button.innerHTML = '<i class="fas fa-trash me-1"></i> Delete';
        }
      });
    });
    
    // AJAX for deduction forms
    const deductionForms = document.querySelectorAll('.deduction-form');
    deductionForms.forEach(form => {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        
        try {
          submitButton.disabled = true;
          submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          const response = await fetch(form.action, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            },
            body: new URLSearchParams(formData)
          });
          
          if (response.ok) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(form.closest('.modal'));
            modal.hide();
            
            // Show success message
            alert('Deduction applied successfully.');
            
            // Reload the page to reflect changes
            window.location.reload();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
          }
        } catch (error) {
          console.error('Error applying deduction:', error);
          alert('An error occurred while applying the deduction. Please try again.');
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
      });
    });
    
    // AJAX for hourly rate forms
    const rateForms = document.querySelectorAll('.rate-form');
    rateForms.forEach(form => {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        
        try {
          submitButton.disabled = true;
          submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          const response = await fetch(form.action, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            },
            body: new URLSearchParams(formData)
          });
          
          if (response.ok) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(form.closest('.modal'));
            modal.hide();
            
            // Update the UI
            const userId = form.action.split('/')[2];
            const hourlyRateValue = formData.get('hourlyRate');
            const cells = document.querySelectorAll('td'); 
            
            // Find the cell with the hourly rate for this user and update it
            let hourlyRateCell = null;
            for (let i = 0; i < cells.length; i++) {
              if (cells[i].textContent === userId) {
                hourlyRateCell = cells[i+1]; // The next cell should be the hourly rate
                break;
              }
            }
            
            if (hourlyRateCell) {
              hourlyRateCell.textContent = `$${parseFloat(hourlyRateValue).toFixed(2)}`;
            }
            
            // Show success message
            alert('Hourly rate updated successfully.');
            
            // Reload the page to reflect changes in calculations
            window.location.reload();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
          }
        } catch (error) {
          console.error('Error updating hourly rate:', error);
          alert('An error occurred while updating the hourly rate. Please try again.');
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
      });
    });
    
    // Tech edit forms
    const techEditForms = document.querySelectorAll('.tech-edit-form');
    techEditForms.forEach(form => {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        
        try {
          submitButton.disabled = true;
          submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          const response = await fetch(form.action, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            },
            body: new URLSearchParams(formData)
          });
          
          if (response.ok) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(form.closest('.modal'));
            modal.hide();
            
            // Show success message
            alert('Request updated successfully.');
            
            // Reload the page to reflect changes
            window.location.reload();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
          }
        } catch (error) {
          console.error('Error updating request:', error);
          alert('An error occurred while updating the request. Please try again.');
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
      });
    });
    
    // Function to update request counts
    function updateRequestCounts() {
      // Update summary cards
      let pendingRequests = document.querySelectorAll('.request-pending').length;
      let approvedRequests = document.querySelectorAll('.request-supervisor, .request-admin, .request-ceo').length;
      
      const pendingCountElement = document.querySelector('.summary-card:nth-child(3) .summary-value');
      const approvedCountElement = document.querySelector('.summary-card:nth-child(4) .summary-value');
      
      if (pendingCountElement) {
        pendingCountElement.textContent = pendingRequests;
      }
      
      if (approvedCountElement) {
        approvedCountElement.textContent = approvedRequests;
      }
      
      // Update user accordions
      document.querySelectorAll('.accordion-item').forEach(item => {
        const requestsInAccordion = item.querySelectorAll('.request-card').length;
        const badgeElement = item.querySelector('.badge');
        
        if (badgeElement) {
          badgeElement.textContent = `${requestsInAccordion} requests`;
        }
        
        // Update batch approve buttons
        const supervisorBatchBtn = item.querySelector('.batch-approve-btn[data-action="supervisor-approve"]');
        const adminBatchBtn = item.querySelector('.batch-approve-btn[data-action="admin-approve"]');
        const ceoBatchBtn = item.querySelector('.batch-approve-btn[data-action="ceo-signoff"]');
        
        if (supervisorBatchBtn) {
          const pendingCount = item.querySelectorAll('.request-pending').length;
          if (pendingCount === 0) {
            supervisorBatchBtn.style.display = 'none';
          } else {
            supervisorBatchBtn.innerHTML = `<i class="fas fa-check-circle me-1"></i> Approve All Pending (${pendingCount})`;
          }
        }
        
        if (adminBatchBtn) {
          const supervisorApprovedCount = item.querySelectorAll('.request-supervisor').length;
          if (supervisorApprovedCount === 0) {
            adminBatchBtn.style.display = 'none';
          } else {
            adminBatchBtn.innerHTML = `<i class="fas fa-check-circle me-1"></i> Admin Approve All (${supervisorApprovedCount})`;
          }
        }
        
        if (ceoBatchBtn) {
          const adminApprovedCount = item.querySelectorAll('.request-admin').length;
          if (adminApprovedCount === 0) {
            ceoBatchBtn.style.display = 'none';
          } else {
            ceoBatchBtn.innerHTML = `<i class="fas fa-signature me-1"></i> Sign Off All (${adminApprovedCount})`;
          }
        }
      });
    }
  });